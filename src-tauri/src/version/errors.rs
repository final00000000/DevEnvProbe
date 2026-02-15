use thiserror::Error;

/// Version management error codes
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VersionErrorCode {
    InvalidInput,
    SourceTimeout,
    SourceUnavailable,
    NoValidSourceResult,
    UpdateConflict,
    StepFailed,
    RollbackFailed,
}

impl VersionErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            VersionErrorCode::InvalidInput => "VERSION_INVALID_INPUT",
            VersionErrorCode::SourceTimeout => "VERSION_SOURCE_TIMEOUT",
            VersionErrorCode::SourceUnavailable => "VERSION_SOURCE_UNAVAILABLE",
            VersionErrorCode::NoValidSourceResult => "VERSION_NO_VALID_SOURCE_RESULT",
            VersionErrorCode::UpdateConflict => "VERSION_UPDATE_CONFLICT",
            VersionErrorCode::StepFailed => "VERSION_STEP_FAILED",
            VersionErrorCode::RollbackFailed => "VERSION_ROLLBACK_FAILED",
        }
    }

    pub fn user_message(&self) -> &'static str {
        match self {
            VersionErrorCode::InvalidInput => "输入参数无效，请检查配置",
            VersionErrorCode::SourceTimeout => "版本检查超时，请稍后重试",
            VersionErrorCode::SourceUnavailable => "版本源不可用，请检查网络连接",
            VersionErrorCode::NoValidSourceResult => "所有版本源检查失败，请检查配置",
            VersionErrorCode::UpdateConflict => "该镜像正在更新中，请稍后重试",
            VersionErrorCode::StepFailed => "更新步骤执行失败",
            VersionErrorCode::RollbackFailed => "回滚失败，请手动恢复",
        }
    }
}

/// Version management errors
#[derive(Debug, Error)]
pub enum VersionError {
    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Source timeout: {0}")]
    SourceTimeout(String),

    #[error("Source unavailable: {0}")]
    SourceUnavailable(String),

    #[error("No valid source result")]
    NoValidSourceResult,

    #[allow(dead_code)]
    #[error("Update conflict: {0}")]
    UpdateConflict(String),

    #[error("Step failed: {step} - {message}")]
    StepFailed { step: String, message: String },

    #[allow(dead_code)]
    #[error("Rollback failed: {0}")]
    RollbackFailed(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("HTTP error: {0}")]
    Http(String),

    #[error("Parse error: {0}")]
    Parse(String),
}

impl VersionError {
    pub fn code(&self) -> VersionErrorCode {
        match self {
            VersionError::InvalidInput(_) => VersionErrorCode::InvalidInput,
            VersionError::SourceTimeout(_) => VersionErrorCode::SourceTimeout,
            VersionError::SourceUnavailable(_) => VersionErrorCode::SourceUnavailable,
            VersionError::NoValidSourceResult => VersionErrorCode::NoValidSourceResult,
            VersionError::UpdateConflict(_) => VersionErrorCode::UpdateConflict,
            VersionError::StepFailed { .. } => VersionErrorCode::StepFailed,
            VersionError::RollbackFailed(_) => VersionErrorCode::RollbackFailed,
            VersionError::Io(_) | VersionError::Http(_) | VersionError::Parse(_) => {
                VersionErrorCode::SourceUnavailable
            }
        }
    }

    pub fn user_message(&self) -> String {
        format!("{}: {}", self.code().user_message(), self)
    }
}

pub type VersionResult<T> = Result<T, VersionError>;
