// Note: this binding has been written by hand and ts_rs does not export this
// type, as there's no (easy) way currently to override the type of the entire
// struct to be a string (which is what serde serializes it to)
export type DeviceKey = string;
