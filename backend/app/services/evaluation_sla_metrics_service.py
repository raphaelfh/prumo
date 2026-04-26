"""Reviewer turnaround SLA metric helpers."""

from datetime import datetime


class EvaluationSlaMetricsService:
    """Computes and evaluates reviewer turnaround SLA targets."""

    SLA_TARGET_HOURS = 24

    @staticmethod
    def turnaround_hours(started_at: datetime, completed_at: datetime) -> float:
        delta = completed_at - started_at
        return max(delta.total_seconds() / 3600, 0.0)

    @classmethod
    def is_within_sla(cls, started_at: datetime, completed_at: datetime) -> bool:
        return cls.turnaround_hours(started_at, completed_at) <= cls.SLA_TARGET_HOURS

    @classmethod
    def build_report(cls, started_at: datetime, completed_at: datetime) -> dict[str, float | bool]:
        hours = cls.turnaround_hours(started_at, completed_at)
        return {
            "turnaround_hours": hours,
            "sla_target_hours": float(cls.SLA_TARGET_HOURS),
            "within_sla": hours <= cls.SLA_TARGET_HOURS,
        }
