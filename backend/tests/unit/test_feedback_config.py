from app.core.config import settings


def test_feedback_settings_have_defaults() -> None:
    assert settings.FEEDBACK_MEDIA_BUCKET == "feedback-media"
    assert settings.FEEDBACK_MAX_IMAGE_BYTES == 10 * 1024 * 1024
    assert settings.FEEDBACK_MAX_VIDEO_BYTES == 50 * 1024 * 1024
    # LINEAR_* default to None unless explicitly set in the environment.
    assert settings.LINEAR_API_KEY is None or isinstance(settings.LINEAR_API_KEY, str)
    assert settings.LINEAR_TEAM_ID is None or isinstance(settings.LINEAR_TEAM_ID, str)
