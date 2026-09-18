//! Bounded length-prefixed JSON IPC for the JavaScript worker.
//!
//! Every frame is a 4-byte big-endian payload length followed by that many
//! UTF-8 JSON bytes. The parent validates the declared length against the
//! direction's cap *before* allocating the payload buffer, so a misbehaving
//! worker cannot make the server allocate an unbounded message.
//!
//! The caps intentionally keep the legacy in-process limits:
//! * script bodies: 64 KiB ([`MAX_SCRIPT_BYTES`]),
//! * serialized invocation context: 8 MiB ([`MAX_CONTEXT_BYTES`]),
//! * script result: 1 MiB ([`MAX_RESULT_BYTES`]),
//! * framed response: 1 MiB + 64 KiB of protocol headroom.
//!
//! These stay in place until the compatibility review in a later package.

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// Bytes of the big-endian u32 frame length prefix.
pub const FRAME_HEADER_BYTES: usize = 4;

/// Script source length cap (legacy in-process limit).
pub const MAX_SCRIPT_BYTES: usize = 64 * 1024;

/// Serialized invocation context cap (legacy in-process limit).
pub const MAX_CONTEXT_BYTES: usize = 8 * 1024 * 1024;

/// Script result cap (legacy in-process limit).
pub const MAX_RESULT_BYTES: usize = 1024 * 1024;

/// Largest request frame the supervisor will produce or the worker will read.
pub const MAX_REQUEST_BYTES: usize = MAX_CONTEXT_BYTES + MAX_SCRIPT_BYTES + 64 * 1024;

/// Largest response frame the worker will produce or the supervisor will read.
pub const MAX_RESPONSE_BYTES: usize = MAX_RESULT_BYTES + 64 * 1024;

/// Script ABI version supported by this build (mirrors
/// `core::automation::compile::SUPPORTED_SCRIPT_API_VERSION`).
pub const SUPPORTED_SCRIPT_API_VERSION: u32 = 1;

/// Legacy (v1) compatibility invocation format version. Lives beside the v2
/// version so the two ABIs can never be silently mixed (Section 6.4).
pub const SUPPORTED_LEGACY_API_VERSION: u32 = 1;

/// Legacy (v1) scene-materializer invocation format version: the same old
/// `devices`/`groups` globals and helper prelude as legacy rules, but the raw
/// JSON expression result instead of boolean truthiness.
pub const SUPPORTED_LEGACY_SCENE_API_VERSION: u32 = 1;

/// Maximum accepted `run_id` length.
pub const MAX_RUN_ID_BYTES: usize = 256;

/// What the worker should do with a script body.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RequestKind {
    /// Parse the v2 function body and execute it, returning its JSON result.
    Execute,
    /// Parse the v2 function body without executing it.
    Validate,
    /// Execute a legacy (v1) rule expression: old `devices`/`groups` globals,
    /// raw expression completion, and plain JavaScript boolean truthiness.
    /// Kept as a distinct kind so the v2 ABI is never applied to v1 scripts.
    ExecuteLegacy,
    /// Execute a legacy (v1) scene expression: the same globals and helper
    /// prelude as [`RequestKind::ExecuteLegacy`], but the expression's raw JSON
    /// result. Kept separate so the v1 scene output format and the strict v2
    /// scene-materializer contract can never be conflated.
    ExecuteLegacyScene,
}

/// Deterministic fault-injection modes used by process-level tests.
///
/// The worker refuses these unless it was started with the hidden
/// `--test-mode` flag, so production supervisors can never trigger them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TestMode {
    /// Answer without touching Boa.
    Echo,
    /// Answer with the inherited environment variable names.
    Env,
    /// Spin forever without answering (timeout/kill test).
    Hang,
    /// Allocate until the kernel refuses, then report how far it got.
    Alloc,
    /// Abort the process without answering (crash test).
    Crash,
    /// Write a truncated frame and exit (protocol truncation test).
    Truncate,
    /// Write a well-framed but invalid response (protocol error test).
    Garbage,
    /// Flood stderr, then spin without answering (diagnostic cap test).
    StderrHang,
}

/// One invocation request sent from the supervisor to a worker process.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScriptRequest {
    /// Supervisor-assigned unique identifier for this invocation.
    pub request_id: u64,
    /// Supervisor-assigned worker incarnation. Overwritten by [`supervisor`]
    /// with the generation of the worker that actually executes the request.
    ///
    /// [`supervisor`]: super::supervisor
    pub generation: u64,
    /// Script ABI version; must equal [`SUPPORTED_SCRIPT_API_VERSION`].
    pub api_version: u32,
    /// Execution or syntax-only validation.
    pub kind: RequestKind,
    /// Function-body source, never executed during compilation.
    pub script: String,
    /// Bounded JSON injected as the immutable `ctx` global.
    #[serde(default)]
    pub context: serde_json::Value,
    /// Optional opaque owner/run identifier for provenance and stale-result
    /// rejection in later packages.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    /// Test-only fault injection; requires the worker's `--test-mode` flag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_mode: Option<TestMode>,
}

impl ScriptRequest {
    /// A request that executes `script` with `context`.
    pub fn execute(request_id: u64, script: impl Into<String>, context: serde_json::Value) -> Self {
        Self {
            request_id,
            generation: 0,
            api_version: SUPPORTED_SCRIPT_API_VERSION,
            kind: RequestKind::Execute,
            script: script.into(),
            context,
            run_id: None,
            test_mode: None,
        }
    }

    /// A request that only syntax-checks `script`.
    pub fn validate(request_id: u64, script: impl Into<String>) -> Self {
        Self {
            request_id,
            generation: 0,
            api_version: SUPPORTED_SCRIPT_API_VERSION,
            kind: RequestKind::Validate,
            script: script.into(),
            context: serde_json::Value::Null,
            run_id: None,
            test_mode: None,
        }
    }

    /// A request that executes a legacy (v1) rule expression with the legacy
    /// invocation context (`{devices, groups}`).
    pub fn execute_legacy(
        request_id: u64,
        script: impl Into<String>,
        context: serde_json::Value,
    ) -> Self {
        Self {
            request_id,
            generation: 0,
            api_version: SUPPORTED_LEGACY_API_VERSION,
            kind: RequestKind::ExecuteLegacy,
            script: script.into(),
            context,
            run_id: None,
            test_mode: None,
        }
    }

    /// A request that executes a legacy (v1) scene expression with the legacy
    /// invocation context (`{devices, groups}`) and returns its raw JSON value.
    pub fn execute_legacy_scene(
        request_id: u64,
        script: impl Into<String>,
        context: serde_json::Value,
    ) -> Self {
        Self {
            request_id,
            generation: 0,
            api_version: SUPPORTED_LEGACY_SCENE_API_VERSION,
            kind: RequestKind::ExecuteLegacyScene,
            script: script.into(),
            context,
            run_id: None,
            test_mode: None,
        }
    }
}

/// One invocation response sent from a worker process to the supervisor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScriptResponse {
    pub request_id: u64,
    pub generation: u64,
    pub ok: bool,
    /// JSON `null` is a valid script result, so a present `null` must
    /// deserialize to `Some(Value::Null)` rather than being conflated with a
    /// missing field.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_present_value"
    )]
    pub value: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn deserialize_present_value<'de, D>(deserializer: D) -> Result<Option<serde_json::Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    serde_json::Value::deserialize(deserializer).map(Some)
}

impl ScriptResponse {
    /// A successful response carrying `value`.
    pub fn success(request_id: u64, generation: u64, value: serde_json::Value) -> Self {
        Self {
            request_id,
            generation,
            ok: true,
            value: Some(value),
            error: None,
        }
    }

    /// A bounded worker-reported failure (the worker itself stays healthy).
    pub fn failure(request_id: u64, generation: u64, message: impl Into<String>) -> Self {
        Self {
            request_id,
            generation,
            ok: false,
            value: None,
            error: Some(message.into()),
        }
    }

    /// Strictly split the response into a value or a worker-reported error.
    pub fn into_result(self) -> Result<serde_json::Value, String> {
        match (self.ok, self.value, self.error) {
            (true, Some(value), None) => Ok(value),
            (false, None, Some(message)) => Err(message),
            _ => Err("malformed script worker response: ok/value/error disagree".to_string()),
        }
    }
}

/// Request-side validation that does not require a worker.
pub fn validate_request(request: &ScriptRequest) -> Result<(), String> {
    let (supported_version, abi) = match request.kind {
        RequestKind::Execute | RequestKind::Validate => (SUPPORTED_SCRIPT_API_VERSION, "script"),
        RequestKind::ExecuteLegacy => (SUPPORTED_LEGACY_API_VERSION, "legacy script"),
        RequestKind::ExecuteLegacyScene => {
            (SUPPORTED_LEGACY_SCENE_API_VERSION, "legacy scene script")
        }
    };
    if request.api_version != supported_version {
        return Err(format!(
            "unsupported {abi} api_version {}; this build supports {}",
            request.api_version, supported_version
        ));
    }
    if request.script.len() > MAX_SCRIPT_BYTES {
        return Err(format!("script exceeds the {MAX_SCRIPT_BYTES} byte limit"));
    }
    if let Some(run_id) = &request.run_id {
        if run_id.len() > MAX_RUN_ID_BYTES {
            return Err(format!("run_id exceeds the {MAX_RUN_ID_BYTES} byte limit"));
        }
    }
    let context_bytes = serde_json::to_vec(&request.context)
        .map_err(|error| format!("context is not JSON-serializable: {error}"))?;
    if context_bytes.len() > MAX_CONTEXT_BYTES {
        return Err(format!(
            "context exceeds the {MAX_CONTEXT_BYTES} byte limit"
        ));
    }
    Ok(())
}

/// Framing failures. These are always protocol-level faults, never script
/// errors.
#[derive(Debug)]
pub enum FrameError {
    /// Zero-length frames are not valid JSON and are rejected outright.
    EmptyFrame,
    /// Declared payload length exceeds the direction's cap.
    TooLarge { length: usize, limit: usize },
    /// EOF in the middle of a header or payload.
    Truncated { part: &'static str },
    /// Underlying transport error.
    Io(std::io::Error),
}

impl std::fmt::Display for FrameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FrameError::EmptyFrame => write!(f, "zero-length frame"),
            FrameError::TooLarge { length, limit } => {
                write!(f, "frame length {length} exceeds limit {limit}")
            }
            FrameError::Truncated { part } => write!(f, "frame truncated in {part}"),
            FrameError::Io(error) => write!(f, "frame I/O error: {error}"),
        }
    }
}

impl std::error::Error for FrameError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            FrameError::Io(error) => Some(error),
            _ => None,
        }
    }
}

fn map_read_error(error: std::io::Error, part: &'static str) -> FrameError {
    if error.kind() == std::io::ErrorKind::UnexpectedEof {
        FrameError::Truncated { part }
    } else {
        FrameError::Io(error)
    }
}

fn frame_header(length: usize, max_bytes: usize) -> Result<[u8; FRAME_HEADER_BYTES], FrameError> {
    if length == 0 {
        return Err(FrameError::EmptyFrame);
    }
    if length > max_bytes {
        return Err(FrameError::TooLarge {
            length,
            limit: max_bytes,
        });
    }
    Ok((length as u32).to_be_bytes())
}

/// Read one frame, blocking, on the worker side.
///
/// Returns `Ok(None)` on a clean EOF at a frame boundary. The payload length
/// is validated before the buffer is allocated.
pub fn read_frame_blocking<R: std::io::Read>(
    reader: &mut R,
    max_bytes: usize,
) -> Result<Option<Vec<u8>>, FrameError> {
    let mut header = [0u8; FRAME_HEADER_BYTES];
    loop {
        match reader.read(&mut header[..1]) {
            Ok(0) => return Ok(None),
            Ok(_) => break,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(FrameError::Io(error)),
        }
    }
    reader
        .read_exact(&mut header[1..])
        .map_err(|error| map_read_error(error, "header"))?;

    let length = u32::from_be_bytes(header) as usize;
    if length == 0 {
        return Err(FrameError::EmptyFrame);
    }
    if length > max_bytes {
        return Err(FrameError::TooLarge {
            length,
            limit: max_bytes,
        });
    }

    let mut payload = vec![0u8; length];
    reader
        .read_exact(&mut payload)
        .map_err(|error| map_read_error(error, "payload"))?;
    Ok(Some(payload))
}

/// Write one frame, blocking, on the worker side.
pub fn write_frame_blocking<W: std::io::Write>(
    writer: &mut W,
    payload: &[u8],
    max_bytes: usize,
) -> Result<(), FrameError> {
    let header = frame_header(payload.len(), max_bytes)?;
    writer.write_all(&header).map_err(FrameError::Io)?;
    writer.write_all(payload).map_err(FrameError::Io)?;
    writer.flush().map_err(FrameError::Io)?;
    Ok(())
}

/// Read one frame from an async transport on the supervisor side.
///
/// Returns `Ok(None)` on a clean EOF at a frame boundary.
pub async fn read_frame<R: AsyncRead + Unpin>(
    reader: &mut R,
    max_bytes: usize,
) -> Result<Option<Vec<u8>>, FrameError> {
    let mut header = [0u8; FRAME_HEADER_BYTES];
    loop {
        match reader.read(&mut header[..1]).await {
            Ok(0) => return Ok(None),
            Ok(_) => break,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(FrameError::Io(error)),
        }
    }
    reader
        .read_exact(&mut header[1..])
        .await
        .map_err(|error| map_read_error(error, "header"))?;

    let length = u32::from_be_bytes(header) as usize;
    if length == 0 {
        return Err(FrameError::EmptyFrame);
    }
    if length > max_bytes {
        return Err(FrameError::TooLarge {
            length,
            limit: max_bytes,
        });
    }

    let mut payload = vec![0u8; length];
    reader
        .read_exact(&mut payload)
        .await
        .map_err(|error| map_read_error(error, "payload"))?;
    Ok(Some(payload))
}

/// Write one frame to an async transport on the supervisor side.
pub async fn write_frame<W: AsyncWrite + Unpin>(
    writer: &mut W,
    payload: &[u8],
    max_bytes: usize,
) -> Result<(), FrameError> {
    let header = frame_header(payload.len(), max_bytes)?;
    writer.write_all(&header).await.map_err(FrameError::Io)?;
    writer.write_all(payload).await.map_err(FrameError::Io)?;
    writer.flush().await.map_err(FrameError::Io)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_blocking_frames() {
        let mut buffer = Vec::new();
        write_frame_blocking(&mut buffer, br#"{"a":1}"#, MAX_REQUEST_BYTES).unwrap();
        let mut cursor = std::io::Cursor::new(buffer);
        let frame = read_frame_blocking(&mut cursor, MAX_REQUEST_BYTES)
            .unwrap()
            .unwrap();
        assert_eq!(frame, br#"{"a":1}"#);
        assert!(read_frame_blocking(&mut cursor, MAX_REQUEST_BYTES)
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn round_trips_async_frames() {
        let mut buffer = Vec::new();
        write_frame(&mut buffer, br#"{"b":2}"#, MAX_RESPONSE_BYTES)
            .await
            .unwrap();
        let mut cursor = std::io::Cursor::new(buffer);
        let frame = read_frame(&mut cursor, MAX_RESPONSE_BYTES)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(frame, br#"{"b":2}"#);
        assert!(read_frame(&mut cursor, MAX_RESPONSE_BYTES)
            .await
            .unwrap()
            .is_none());
    }

    #[test]
    fn rejects_oversized_and_empty_frames_before_reading() {
        let mut reader = std::io::Cursor::new(vec![0u8, 0, 0, 0]);
        assert!(matches!(
            read_frame_blocking(&mut reader, MAX_REQUEST_BYTES),
            Err(FrameError::EmptyFrame)
        ));

        let oversized = (MAX_REQUEST_BYTES as u32 + 1).to_be_bytes();
        let mut reader = std::io::Cursor::new(oversized.to_vec());
        assert!(matches!(
            read_frame_blocking(&mut reader, MAX_REQUEST_BYTES),
            Err(FrameError::TooLarge { .. })
        ));

        let mut buffer = Vec::new();
        assert!(matches!(
            write_frame_blocking(&mut buffer, &[], MAX_RESPONSE_BYTES),
            Err(FrameError::EmptyFrame)
        ));
        assert!(matches!(
            write_frame_blocking(&mut buffer, &[0u8; 4], 2),
            Err(FrameError::TooLarge { .. })
        ));
    }

    #[test]
    fn reports_truncated_frames() {
        let mut reader = std::io::Cursor::new(vec![0u8, 0, 0, 8, 1, 2]);
        assert!(matches!(
            read_frame_blocking(&mut reader, MAX_REQUEST_BYTES),
            Err(FrameError::Truncated { part: "payload" })
        ));

        let mut reader = std::io::Cursor::new(vec![0u8, 0]);
        assert!(matches!(
            read_frame_blocking(&mut reader, MAX_REQUEST_BYTES),
            Err(FrameError::Truncated { part: "header" })
        ));
    }

    #[test]
    fn validates_request_limits() {
        let mut request = ScriptRequest::execute(1, "return 1;", serde_json::Value::Null);
        assert!(validate_request(&request).is_ok());

        request.api_version = SUPPORTED_SCRIPT_API_VERSION + 1;
        assert!(validate_request(&request).is_err());

        request.api_version = SUPPORTED_SCRIPT_API_VERSION;
        request.script = " ".repeat(MAX_SCRIPT_BYTES + 1);
        assert!(validate_request(&request).is_err());

        request.script = "return 1;".to_string();
        request.run_id = Some("x".repeat(MAX_RUN_ID_BYTES + 1));
        assert!(validate_request(&request).is_err());
    }

    #[test]
    fn legacy_requests_validate_against_the_legacy_api_version() {
        let legacy = ScriptRequest::execute_legacy(
            1,
            "devices['a'] !== undefined",
            serde_json::json!({"devices": {}, "groups": {}}),
        );
        assert_eq!(legacy.kind, RequestKind::ExecuteLegacy);
        assert_eq!(legacy.api_version, SUPPORTED_LEGACY_API_VERSION);
        assert!(validate_request(&legacy).is_ok());

        let mut mismatched = legacy;
        mismatched.api_version = SUPPORTED_SCRIPT_API_VERSION + 1;
        assert!(validate_request(&mismatched).is_err());
    }

    #[test]
    fn legacy_scene_requests_validate_against_the_legacy_scene_api_version() {
        let scene = ScriptRequest::execute_legacy_scene(
            1,
            "defineSceneScript(function () { return {}; })",
            serde_json::json!({"devices": {}, "groups": {}}),
        );
        assert_eq!(scene.kind, RequestKind::ExecuteLegacyScene);
        assert_eq!(scene.api_version, SUPPORTED_LEGACY_SCENE_API_VERSION);
        assert!(validate_request(&scene).is_ok());

        let mut mismatched = scene;
        mismatched.api_version = SUPPORTED_SCRIPT_API_VERSION + 1;
        assert!(validate_request(&mismatched).is_err());
    }

    #[test]
    fn response_shape_is_strict() {
        let success = ScriptResponse::success(1, 2, serde_json::json!({"ok": true}));
        assert_eq!(success.into_result().unwrap()["ok"], true);

        let failure = ScriptResponse::failure(1, 2, "boom");
        assert_eq!(failure.into_result().unwrap_err(), "boom");

        let malformed = ScriptResponse {
            request_id: 1,
            generation: 2,
            ok: true,
            value: None,
            error: Some("conflict".to_string()),
        };
        assert!(malformed.into_result().is_err());

        let unknown_field = br#"{"request_id":1,"generation":2,"ok":true,"value":null,"extra":1}"#;
        assert!(serde_json::from_slice::<ScriptResponse>(unknown_field).is_err());
    }
}
