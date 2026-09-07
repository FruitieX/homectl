//! Independent FIFO lanes: database latency cannot hold up integration dispatch.
use super::event::DeferredEventWork;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

pub fn spawn_deferred_worker() -> mpsc::UnboundedSender<DeferredEventWork> {
    let (tx, mut rx) = mpsc::unbounded_channel::<DeferredEventWork>();
    let dispatch = lane("integration dispatch", DeferredEventWork::execute);
    let persistence = lane("persistence", DeferredEventWork::execute);
    tokio::spawn(async move {
        while let Some(work) = rx.recv().await {
            let target = match &work {
                DeferredEventWork::PublishIntegrationState { .. }
                | DeferredEventWork::RunIntegrationAction { .. } => &dispatch,
                _ => &persistence,
            };
            if target.send((Instant::now(), work)).is_err() {
                error!("Deferred work lane closed");
            }
        }
    });
    tx
}

fn lane<T, F, Fut>(name: &'static str, execute: F) -> mpsc::UnboundedSender<(Instant, T)>
where
    T: Send + 'static,
    F: Fn(T) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = color_eyre::Result<()>> + Send,
{
    let (tx, mut rx) = mpsc::unbounded_channel::<(Instant, T)>();
    tokio::spawn(async move {
        while let Some((queued, work)) = rx.recv().await {
            let wait = queued.elapsed();
            let started = Instant::now();
            if let Err(error) = execute(work).await {
                error!("{name} failed: {error:#}");
            }
            let elapsed = started.elapsed();
            if wait > Duration::from_millis(250) || elapsed > Duration::from_secs(1) {
                warn!(
                    "{name}: queue wait {wait:?}, execution {elapsed:?}, remaining {}",
                    rx.len()
                );
            }
        }
    });
    tx
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn blocked_persistence_does_not_block_dispatch_and_each_lane_is_fifo() {
        let (release, blocked) = tokio::sync::oneshot::channel::<()>();
        let (observed, mut events) = mpsc::unbounded_channel();
        let persistence = lane(
            "test persistence",
            move |(id, wait): (u8, Option<tokio::sync::oneshot::Receiver<()>>)| {
                let observed = observed.clone();
                async move {
                    if let Some(wait) = wait {
                        let _ = wait.await;
                    }
                    observed.send(id)?;
                    Ok(())
                }
            },
        );
        let (sent, mut dispatched) = mpsc::unbounded_channel();
        let dispatch = lane("test dispatch", move |id: u8| {
            let sent = sent.clone();
            async move {
                sent.send(id)?;
                Ok(())
            }
        });
        persistence
            .send((Instant::now(), (1, Some(blocked))))
            .unwrap();
        persistence.send((Instant::now(), (2, None))).unwrap();
        dispatch.send((Instant::now(), 3)).unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), dispatched.recv())
                .await
                .unwrap(),
            Some(3)
        );
        assert!(events.try_recv().is_err());
        release.send(()).unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), events.recv())
                .await
                .unwrap(),
            Some(1)
        );
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), events.recv())
                .await
                .unwrap(),
            Some(2)
        );
    }
}
