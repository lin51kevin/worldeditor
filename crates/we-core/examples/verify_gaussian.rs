//! Throwaway verification: parse a real 3DGS PLY and print stats.
//! Run: cargo run -p we-core --example verify_gaussian -- <path>
use we_core::pointcloud::gaussian::parse_gaussian_ply;

fn main() {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "E:/data-root/assets/20003/20003.ply".to_string());
    let bytes = std::fs::read(&path).expect("read ply");
    let cloud = parse_gaussian_ply(&bytes).expect("parse gaussian");
    println!("path: {path}");
    println!("splats: {}", cloud.len());
    println!("sh_degree: {}", cloud.sh_degree());
    println!("coeffs/channel: {}", cloud.coeffs_per_channel());
    println!("origin: {:?}", cloud.origin());
    let b = cloud.bounds();
    println!("bounds.min: {:?}", b.min);
    println!("bounds.max: {:?}", b.max);
    println!("size: {:?}", b.size());
    // Sample a few splats.
    for i in [0usize, cloud.len() / 2, cloud.len() - 1] {
        let c = cloud.color_band0(i).unwrap();
        let o = cloud.opacity()[i];
        let cov = &cloud.cov3d()[i * 6..i * 6 + 6];
        println!("splat {i}: color={c:?} opacity={o:.3} cov={cov:?}");
    }
    let buf = cloud.build_splat_buffer();
    println!("splat buffer floats: {} ({} MB)", buf.len(), buf.len() * 4 / (1024 * 1024));
}
