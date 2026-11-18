"""Per-business agent settings, stored in `tenants.settings` (JSON)."""

from pydantic import BaseModel, Field, field_validator

WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


class Service(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    minutes: int = Field(default=30, ge=5, le=480)


class BookingSettings(BaseModel):
    slot_minutes: int = Field(default=30, ge=5, le=240)  # spacing between offered start times
    # "HH:MM-HH:MM" per weekday, or null when closed
    hours: dict[str, str | None] = Field(
        default_factory=lambda: {
            "mon": "09:00-18:00",
            "tue": "09:00-18:00",
            "wed": "09:00-18:00",
            "thu": "09:00-18:00",
            "fri": "09:00-18:00",
            "sat": "09:00-14:00",
            "sun": None,
        }
    )
    services: list[Service] = Field(default_factory=lambda: [Service(name="Consultation", minutes=30)])
    max_days_ahead: int = Field(default=60, ge=1, le=365)

    @field_validator("hours")
    @classmethod
    def _check_hours(cls, v: dict[str, str | None]) -> dict[str, str | None]:
        for day, span in v.items():
            if day not in WEEKDAYS:
                raise ValueError(f"Unknown weekday '{day}'")
            if span is None:
                continue
            try:
                start, end = span.split("-")
                sh, sm = map(int, start.split(":"))
                eh, em = map(int, end.split(":"))
            except ValueError as exc:
                raise ValueError(f"Hours for {day} must look like 09:00-18:00") from exc
            if not (0 <= sh * 60 + sm < eh * 60 + em <= 24 * 60):
                raise ValueError(f"Closing time must be after opening time on {day}")
        return v


class ToolSwitches(BaseModel):
    booking: bool = True
    orders: bool = True
    handoff: bool = True


class BusinessSettings(BaseModel):
    timezone: str = "Europe/Istanbul"
    tools: ToolSwitches = Field(default_factory=ToolSwitches)
    booking: BookingSettings = Field(default_factory=BookingSettings)


def load_settings(raw: dict | None) -> BusinessSettings:
    """Parse stored settings, filling in defaults for anything missing."""
    return BusinessSettings.model_validate(raw or {})
