use palette::{rgb::Rgb, Yxy};

pub fn xy_to_cct(color: &Yxy) -> f32 {
    let x = color.x;
    let y = color.y;

    // McCamy's approximation
    let n = (x - 0.3320) / (0.1858 - y);
    437.0 * n.powf(3.0) + 3601.0 * n.powf(2.0) + 6861.0 * n + 5517.0
}

pub fn cct_to_rgb(kelvin: f32) -> Rgb {
    let temp = kelvin as f64 / 100.0;

    let (red, green, blue) = if temp <= 66.0 {
        let red = 255.0;

        let green = 99.4708025861 * f64::log10(temp) - 161.1195681661;

        let blue = if temp <= 19.0 {
            0.0
        } else {
            138.5177312231 * f64::log10(temp - 10.0) - 305.0447927307
        };

        (red, green, blue)
    } else {
        let red = temp - 60.0;
        let red = 329.698727446 * f64::powf(red, -0.1332047592);

        let green = temp - 60.0;
        let green = 288.1221695283 * f64::log(green, -0.0755148492);

        let blue = 255.0;

        (red, green, blue)
    };

    Rgb::new(red as f32, green as f32, blue as f32)
}
