use palette::Yxy;

pub fn xy_to_cct(color: &Yxy) -> f32 {
    let x = color.x;
    let y = color.y;

    // McCamy's approximation
    let n = (x - 0.3320) / (0.1858 - y);
    437.0 * n.powf(3.0) + 3601.0 * n.powf(2.0) + 6861.0 * n + 5517.0
}
