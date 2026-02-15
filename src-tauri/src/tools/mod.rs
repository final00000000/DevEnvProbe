pub mod specs;
pub mod detect;

pub const TOOL_DETECT_TIMEOUT_MS: u64 = 1_500;
pub const AI_TOOL_DETECT_TIMEOUT_MS: u64 = 4_500;

pub use specs::default_tool_specs;
pub use detect::detect_tool;
