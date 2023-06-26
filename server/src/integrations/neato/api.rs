use anyhow::{anyhow, Result};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

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

#[derive(Deserialize)]
struct Robot {
    secret_key: String,
    serial: String,
    nucleo_url: String,
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

const BASE_URL: &str = "https://beehive.neatocloud.com";

type HmacSha256 = Hmac<Sha256>;

pub enum RobotCmd {
    StartCleaning,
    StopCleaning,
}

pub async fn clean_house(config: &NeatoConfig, cmd: &RobotCmd) -> Result<()> {
    let body = AuthBody {
        email: config.email.clone(),
        password: config.password.clone(),
    };

    let token = surf::post(&format!("{}/sessions", BASE_URL))
        .body(surf::Body::from_json(&body).map_err(|err| anyhow!(err))?)
        .await
        .map_err(|err| anyhow!(err))?
        .body_json::<SessionsResponse>()
        .await
        .map_err(|err| anyhow!(err))?
        .access_token;

    let robots = surf::get(&format!("{}/users/me/robots", BASE_URL))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|err| anyhow!(err))?
        .body_json::<Vec<Robot>>()
        .await
        .map_err(|err| anyhow!(err))?;

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
        .body(surf::Body::from_json(&robot_message).map_err(|err| anyhow!(err))?)
        .await
        .map_err(|err| anyhow!(err))?
        .body_string()
        .await
        .map_err(|err| anyhow!(err))?;

        debug!("response: {}", result);
    }

    Ok(())
}
