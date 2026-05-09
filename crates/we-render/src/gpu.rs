//! GPU context — device, queue, adapter initialization.
//!
//! Wraps wgpu device setup for both native and WebGPU backends.

use log::info;

/// Holds the wgpu device, queue, and adapter.
pub struct GpuContext {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub adapter: wgpu::Adapter,
}

impl GpuContext {
    /// Create a GPU context without a surface (headless / testing).
    pub async fn new_headless() -> Result<Self, GpuError> {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            ..Default::default()
        });

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
            .ok_or(GpuError::NoAdapter)?;

        info!("GPU adapter: {:?}", adapter.get_info().name);

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("WorldEditor Device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_webgl2_defaults(),
                    memory_hints: wgpu::MemoryHints::default(),
                },
                None,
            )
            .await
            .map_err(|e| GpuError::DeviceRequest(e.to_string()))?;

        Ok(Self {
            device,
            queue,
            adapter,
        })
    }

    /// Create a GPU context from an existing surface.
    pub async fn new_with_surface(surface: &wgpu::Surface<'_>) -> Result<Self, GpuError> {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            ..Default::default()
        });

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(surface),
                force_fallback_adapter: false,
            })
            .await
            .ok_or(GpuError::NoAdapter)?;

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("WorldEditor Device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_webgl2_defaults(),
                    memory_hints: wgpu::MemoryHints::default(),
                },
                None,
            )
            .await
            .map_err(|e| GpuError::DeviceRequest(e.to_string()))?;

        Ok(Self {
            device,
            queue,
            adapter,
        })
    }
}

/// GPU initialization errors.
#[derive(Debug, Clone)]
pub enum GpuError {
    NoAdapter,
    DeviceRequest(String),
}

impl std::fmt::Display for GpuError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GpuError::NoAdapter => write!(f, "No suitable GPU adapter found"),
            GpuError::DeviceRequest(e) => write!(f, "Failed to request GPU device: {e}"),
        }
    }
}

impl std::error::Error for GpuError {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::error::Error as _;

    #[test]
    fn test_gpu_error_display_no_adapter() {
        assert_eq!(
            GpuError::NoAdapter.to_string(),
            "No suitable GPU adapter found"
        );
    }

    #[test]
    fn test_gpu_error_display_device_request() {
        let error = GpuError::DeviceRequest("device lost".to_string());

        assert_eq!(
            error.to_string(),
            "Failed to request GPU device: device lost"
        );
    }

    #[test]
    fn test_gpu_error_debug() {
        assert_eq!(format!("{:?}", GpuError::NoAdapter), "NoAdapter");
        assert_eq!(
            format!("{:?}", GpuError::DeviceRequest("device lost".to_string())),
            "DeviceRequest(\"device lost\")"
        );
    }

    #[test]
    fn test_gpu_error_is_std_error() {
        fn assert_std_error<E: std::error::Error>() {}

        assert_std_error::<GpuError>();
        assert!(GpuError::NoAdapter.source().is_none());
    }
}
