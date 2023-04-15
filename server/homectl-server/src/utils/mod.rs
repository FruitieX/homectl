use anyhow::Result;
use serde::{de, Deserialize};

pub fn from_hh_mm<'de, D>(d: D) -> Result<chrono::NaiveTime, D::Error>
where
    D: de::Deserializer<'de>,
{
    let str = String::deserialize(d)?;
    chrono::NaiveTime::parse_from_str(&str, "%H:%M").map_err(serde::de::Error::custom)
}
