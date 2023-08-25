use std::fmt;

use chrono::Utc;
use color_eyre::Result;
use eyre::eyre;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_repr::{Serialize_repr, Deserialize_repr};
use sha2::Sha256;

use crate::types::{device::{Device, DeviceId}, integration::IntegrationId};

use super::NeatoConfig;

#[derive(Deserialize)]
struct SessionsResponse {
    access_token: String,
}

#[derive(Serialize)]
struct AuthBody {
    email: String,
    password: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Robot {
    secret_key: String,
    pub serial: String,
    nucleo_url: String,
    pub name: String,
    mac_address: String,
    model: String,
    pub state: Option<NeatoState>,
}

#[derive(Serialize)]
struct HouseCleaningParams {
    /// Should be set to 4 for persistent map
    category: u32,

    /// 1 is eco, 2 is turbo
    mode: u32,

    /// 1 is normal, 2 is extra care, 3 is deep. 3 requires mode = 2.
    #[serde(rename = "navigationMode")]
    navigation_mode: u32,
}

#[derive(Serialize)]
struct RobotMessage {
    #[serde(rename = "reqId")]
    req_id: String,
    cmd: String,
    params: Option<HouseCleaningParams>,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct RobotStateDetails {
    #[serde(rename = "isCharging")]
    is_charging: bool,
    #[serde(rename = "isDocked")]
    is_docked: bool,
    #[serde(rename = "isScheduleEnabled")]
    is_schedule_enabled: bool,
    #[serde(rename = "dockHasBeenSeen")]
    dock_has_been_seen: bool,
    charge: i8,
}

#[derive(Clone, Copy, Serialize_repr, Deserialize_repr, Debug)]
#[repr(u8)]
pub enum RobotState {
    Invalid = 0,
    Idle = 1,
    Busy = 2,
    Paused = 3,
    Error = 4,
}

impl fmt::Display for RobotState {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{:?}", self)
        // or, alternatively:
        // fmt::Debug::fmt(self, f)
    }
}

// https://developers.neatorobotics.com/api/robot-remote-protocol/request-response-formats#13-6-strong-code-action-code-em-integer-em-strong
// action: integer
// If the state is busy, this element specifies what the robot is or has been busy doing. 
// If the state is pause or error, it specifies the activity that the Robot was doing. 
// If state is other, this element is null.
#[derive(Clone, Copy, Serialize_repr, Deserialize_repr, Debug)]
#[repr(u8)]
pub enum RobotAction {
    Invalid = 0,
    HouseCleaning = 1,
    SpotCleaning = 2,
    ManualCleaning = 3,
    Docking = 4,
    UserMenuActive = 5,
    SuspendedCleaning = 6,
    Updating = 7,
    CopyingLogs = 8,
    RecoveringLocation = 9,
    IECTest = 10,
    MapCleaning = 11,
    ExploringMap = 12,
    AcquiringPersisntentMapIDs = 13,
    CreatingAndUploadingMap = 14,
    SuspendedExploration = 15,
}

impl fmt::Display for RobotAction {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{:?}", self)
        // or, alternatively:
        // fmt::Debug::fmt(self, f)
    }
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct NeatoState {
    pub alert: Option<String>,
    pub error: Option<String>,
    pub details: RobotStateDetails,
    pub state: RobotState,
    pub action: RobotAction,
}

const BASE_URL: &str = "https://beehive.neatocloud.com";

type HmacSha256 = Hmac<Sha256>;

pub enum RobotCmd {
    StartCleaning,
    StopCleaning,
}

pub async fn get_robots(config: &NeatoConfig) -> Result<Vec<Robot>> {
    let body = AuthBody {
        email: config.email.clone(),
        password: config.password.clone(),
    };

    let token = surf::post(&format!("{}/sessions", BASE_URL))
        .body(surf::Body::from_json(&body).map_err(|err| eyre!(err))?)
        .await
        .map_err(|err| eyre!(err))?
        .body_json::<SessionsResponse>()
        .await
        .map_err(|err| eyre!(err))?
        .access_token;

    let robots = surf::get(&format!("{}/users/me/robots", BASE_URL))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|err| eyre!(err))?
        // .body_string() // in case you want to debug the whole response
        .body_json::<Vec<Robot>>()
        .await
        .map_err(|err| eyre!(err))?;

    Ok(robots)
}

pub async fn update_robot_states(robots: Vec<Robot>) -> Result<Vec<Robot>> {
    let mut robots_with_state: Vec<Robot> = Vec::new();

    for robot in robots {
        // https://developers.neatorobotics.com/api/nucleo

        let robot_message = RobotMessage {
                req_id: String::from("77"),
                // cmd: String::from("getGeneralInfo"),
                // cmd: String::from("getRobotInfo"),
                cmd: String::from("getRobotState"),
                params: None,
            };

        let serial = robot.serial.to_lowercase();
        let date: String = format!("{}", Utc::now().format("%a, %d %b %Y %H:%M:%S GMT"));
        let body = serde_json::to_string(&robot_message)?;
        let string_to_sign = format!("{}\n{}\n{}", serial, date, body);

        // Create HMAC-SHA256 instance which implements `Mac` trait
        let mut mac = HmacSha256::new_from_slice(robot.secret_key.as_bytes())
            .expect("HMAC can take key of any size");
        mac.update(string_to_sign.as_bytes());

        let signature = hex::encode(mac.finalize().into_bytes());

        let result = surf::post(&format!(
            "{}/vendors/neato/robots/{}/messages",
            robot.nucleo_url, robot.serial
        ))
            .header("Accept", "application/vnd.neato.nucleo.v1")
            .header("Date", date)
            .header("Authorization", format!("NEATOAPP {}", signature))
            .body(surf::Body::from_json(&robot_message).map_err(|err| eyre!(err))?)
            .await
            .map_err(|err| eyre!(err))?
            .body_json::<NeatoState>()
            // .body_string()
            .await
            .map_err(|err| eyre!(err))?;

        let mut r = robot.clone();

        r.state = Some(result);
        robots_with_state.push(r);
    }

    Ok(robots_with_state)
}

pub async fn debug_robot_states(robot: Robot) -> Result<()> {
    // https://developers.neatorobotics.com/api/nucleo

    let robot_message = RobotMessage {
            req_id: String::from("77"),
            // cmd: String::from("getGeneralInfo"),
            // cmd: String::from("getRobotInfo"),
            cmd: String::from("getRobotState"),
            params: None,
        };

    let serial = robot.serial.to_lowercase();
    let date: String = format!("{}", Utc::now().format("%a, %d %b %Y %H:%M:%S GMT"));
    let body = serde_json::to_string(&robot_message)?;
    let string_to_sign = format!("{}\n{}\n{}", serial, date, body);

    // Create HMAC-SHA256 instance which implements `Mac` trait
    let mut mac = HmacSha256::new_from_slice(robot.secret_key.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(string_to_sign.as_bytes());

    let signature = hex::encode(mac.finalize().into_bytes());

    let result = surf::post(&format!(
        "{}/vendors/neato/robots/{}/messages",
        robot.nucleo_url, robot.serial
    ))
        .header("Accept", "application/vnd.neato.nucleo.v1")
        .header("Date", date)
        .header("Authorization", format!("NEATOAPP {}", signature))
        .body(surf::Body::from_json(&robot_message).map_err(|err| eyre!(err))?)
        .await
        .map_err(|err| eyre!(err))?
        // .body_json::<RobotState>()
        .body_string()
        .await
        .map_err(|err| eyre!(err))?;

    debug!("response: {:?}", result);
    
    let serialized_result: NeatoState = serde_json::from_str(&result).unwrap();
    debug!("Serialized response: {:?}", serialized_result);

    Ok(())
}

pub async fn clean_house(config: &NeatoConfig, cmd: &RobotCmd) -> Result<()> {
    let robots = get_robots(config).await?;

    for robot in robots {
        // https://developers.neatorobotics.com/api/nucleo

        let robot_message = if config.dummy {
            RobotMessage {
                req_id: String::from("77"),
                cmd: String::from("getRobotState"),
                params: None,
            }
        } else {
            let params = Some(HouseCleaningParams {
                category: 4,
                mode: 1,
                navigation_mode: 2,
            });

            RobotMessage {
                req_id: String::from("77"),
                cmd: match cmd {
                    RobotCmd::StartCleaning => String::from("startCleaning"),
                    RobotCmd::StopCleaning => String::from("stopCleaning"),
                },
                params,
            }
        };

        let serial = robot.serial.to_lowercase();
        let date: String = format!("{}", Utc::now().format("%a, %d %b %Y %H:%M:%S GMT"));
        let body = serde_json::to_string(&robot_message)?;
        let string_to_sign = format!("{}\n{}\n{}", serial, date, body);

        // Create HMAC-SHA256 instance which implements `Mac` trait
        let mut mac = HmacSha256::new_from_slice(robot.secret_key.as_bytes())
            .expect("HMAC can take key of any size");
        mac.update(string_to_sign.as_bytes());

        let signature = hex::encode(mac.finalize().into_bytes());

        let result = surf::post(&format!(
            "{}/vendors/neato/robots/{}/messages",
            robot.nucleo_url, robot.serial
        ))
        .header("Accept", "application/vnd.neato.nucleo.v1")
        .header("Date", date)
        .header("Authorization", format!("NEATOAPP {}", signature))
        .body(surf::Body::from_json(&robot_message).map_err(|err| eyre!(err))?)
        .await
        .map_err(|err| eyre!(err))?
        .body_string()
        .await
        .map_err(|err| eyre!(err))?;

        debug!("response: {}", result);
    }

    Ok(())
}
