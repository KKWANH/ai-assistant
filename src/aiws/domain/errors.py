class DomainError(ValueError):
    """Base class for domain invariant failures."""


class InvalidSlugError(DomainError):
    """Raised when a slug is malformed."""


class InvalidProjectPathError(DomainError):
    """Raised when a project path violates AIWS path rules."""


class CapabilityViolationError(DomainError):
    """Raised when an action asks for disallowed capabilities."""
