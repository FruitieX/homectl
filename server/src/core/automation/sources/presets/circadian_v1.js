// Built-in circadian preset, version 1 (shipped application asset).
//
// This is a forkable JavaScript port of the frozen circadian curve: a linear
// day fade, a sine-eased night fade, Kelvin interpolation rounded to whole
// Kelvin, and optional brightness that stays absent unless both ends define
// it. Parameters are validated strictly on the server before this body runs,
// so the code assumes `HH:MM` fades that do not cross midnight and do not
// overlap. Kelvin and HS endpoint pairs are both supported; mixed kinds are
// rejected by validation.
//
// The host injects civil time (`ctx.local`); the script never guesses a
// timezone from `Date`.

var p = ctx.params;
var dayStart = api.time.parseHHMM(p.day_fade_start);
var dayEnd = dayStart + p.day_fade_duration_hours * 60;
var nightStart = api.time.parseHHMM(p.night_fade_start);
var nightEnd = nightStart + p.night_fade_duration_hours * 60;
var now = api.time.minutes();

var night; // 1.0 at night, 0.0 during the day
if (now <= dayStart || now >= nightEnd) {
  night = 1;
} else if (now >= dayEnd && now <= nightStart) {
  night = 0;
} else if (now < dayEnd) {
  night = 1 - (now - dayStart) / (dayEnd - dayStart);
} else {
  night = api.time.easeSine((now - nightStart) / (nightEnd - nightStart));
}

var value = {
  color: api.color.mix(p.day_color, p.night_color, night),
  transition_ms: 60000,
};
if (
  p.day_brightness !== undefined &&
  p.day_brightness !== null &&
  p.night_brightness !== undefined &&
  p.night_brightness !== null
) {
  value.brightness = api.time.lerp(p.day_brightness, p.night_brightness, night);
}

return { value: value };
