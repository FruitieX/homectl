use std::{collections::BTreeMap, hash::Hash};

use color_eyre::Result;
use serde::{de, Deserialize};

pub fn from_hh_mm<'de, D>(d: D) -> Result<chrono::NaiveTime, D::Error>
where
    D: de::Deserializer<'de>,
{
    let str = String::deserialize(d)?;
    chrono::NaiveTime::parse_from_str(&str, "%H:%M").map_err(serde::de::Error::custom)
}

pub fn keys_match<T: Eq + Hash + Ord, U, V>(
    map1: &BTreeMap<T, U>, 
    map2: &BTreeMap<T, V>,
) -> bool {
    map1.len() == map2.len() && map1.keys().all(|k| map2.contains_key(k))
}