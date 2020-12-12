use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio_compat_02::FutureExt;
use anyhow::Result;
use chrono::Utc;
use sha2::Sha256;
use hmac::{Hmac, Mac, NewMac};

use super::NeatoConfig;

#[derive(Deserialize)]
struct SessionsResponse {
  access_token: String
}

#[derive(Serialize)]
struct AuthBody {
  email: String,
  password: String
}

#[derive(Deserialize)]
struct Robot {
  secret_key: String,
  serial: String,
  nucleo_url: String
}

#[derive(Serialize)]
struct HouseCleaningParams {
  /// Should be set to 4 for persistent map
  category: u32,

  /// 1 is eco, 2 is turbo
  mode: u32,

  /// 1 is normal, 2 is extra care, 3 is deep. 3 requires mode = 2.
  #[serde(rename = "navigationMode")]
  navigation_mode: u32
}

#[derive(Serialize)]
struct RobotMessage {
  #[serde(rename = "reqId")]
  req_id: String,
  cmd: String,
  params: Option<HouseCleaningParams>
}

const BASE_URL: &str = "https://beehive.neatocloud.com";

type HmacSha256 = Hmac<Sha256>;

pub async fn clean_house(config: &NeatoConfig) -> Result<()> {
  let body = AuthBody {
      email: config.email.clone(),
      password: config.password.clone(),
  };

  let token = Client::builder()
    .build()?
    .post(&format!(
        "{}/sessions",
        BASE_URL
    ))
    .json(&body)
    .send()
    .compat()
    .await?
    .json::<SessionsResponse>()
    .compat()
    .await?.access_token;

  let robots = Client::builder()
    .build()?
    .get(&format!(
        "{}/users/me/robots",
        BASE_URL
    ))
    .header("Authorization", format!("Bearer {}", token))
    .send()
    .compat()
    .await?
    .json::<Vec<Robot>>()
    .compat()
    .await?;

  for robot in robots {
    // https://developers.neatorobotics.com/api/nucleo

    let robot_message = if config.dummy {
      RobotMessage {
        req_id: String::from("77"),
        cmd: String::from("getRobotState"),
        params: None
      }
    } else {
      let params = Some(HouseCleaningParams {
        category: 4,
        mode: 1,
        navigation_mode: 2
      });

      RobotMessage {
        req_id: String::from("77"),
        cmd: String::from("startCleaning"),
        params
      }
    };

    let serial = robot.serial.to_lowercase();
    let date: String = format!("{}", Utc::now().format("%a, %d %b %Y %H:%M:%S GMT"));
    let body = serde_json::to_string(&robot_message)?;
    let string_to_sign = format!("{}\n{}\n{}", serial, date, body);

    // Create HMAC-SHA256 instance which implements `Mac` trait
    let mut mac = HmacSha256::new_varkey(robot.secret_key.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(string_to_sign.as_bytes());

    let signature = hex::encode(mac.finalize().into_bytes());

    let result = Client::builder()
      .build()?
      .post(&format!(
          "{}/vendors/neato/robots/{}/messages",
          robot.nucleo_url, robot.serial
      ))
      .header("Accept", "application/vnd.neato.nucleo.v1")
      .header("Date", date)
      .header("Authorization", format!("NEATOAPP {}", signature))
      .json(&robot_message)
      .send()
      .compat()
      .await?
      .text()
      .compat()
      .await?;

    println!("response: {}", result);
  }

  Ok(())
}
