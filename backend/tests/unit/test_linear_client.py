"""Unit tests for LinearClient — the httpx boundary is mocked."""

from unittest.mock import AsyncMock, patch

import pytest

from app.services.linear.linear_client import LinearClient, LinearError


def _resp(json_body, status=200):
    m = AsyncMock()
    m.json = lambda: json_body
    m.status_code = status
    m.raise_for_status = lambda: None
    return m


@pytest.fixture
def client() -> LinearClient:
    return LinearClient(api_key="key", team_id="team-1")


async def test_create_issue_sends_input_and_parses_issue(client: LinearClient) -> None:
    body = {"data": {"issueCreate": {"success": True,
            "issue": {"id": "i1", "identifier": "PRU-123", "url": "https://linear/PRU-123"}}}}
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_resp(body))) as post:
        issue = await client.create_issue(
            title="t", description="d", priority=2, label_ids=["l1", "l2"]
        )
    assert issue["identifier"] == "PRU-123"
    sent = post.call_args.kwargs["json"]["variables"]["input"]
    assert sent["teamId"] == "team-1"
    assert sent["priority"] == 2
    assert sent["labelIds"] == ["l1", "l2"]


async def test_graphql_raises_on_errors(client: LinearClient) -> None:
    body = {"errors": [{"message": "bad"}]}
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_resp(body))), pytest.raises(LinearError):
        await client.create_issue(title="t", description="d", priority=0, label_ids=[])


async def test_resolve_labels_creates_missing(client: LinearClient) -> None:
    team_labels = {"data": {"team": {"labels": {"nodes": [{"id": "L_bug", "name": "Bug"}]}}}}
    created = {"data": {"issueLabelCreate": {"success": True,
              "issueLabel": {"id": "L_src", "name": "source:in-app"}}}}
    with patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=[_resp(team_labels), _resp(created)])):
        ids = await client.resolve_labels(["Bug", "source:in-app"])
    assert ids == ["L_bug", "L_src"]


async def test_upload_file_requests_url_then_puts(client: LinearClient) -> None:
    up = {"data": {"fileUpload": {"success": True, "uploadFile": {
        "uploadUrl": "https://upload/put", "assetUrl": "https://asset/x.webp",
        "headers": [{"key": "x-h", "value": "v"}]}}}}
    post = AsyncMock(return_value=_resp(up))
    put = AsyncMock(return_value=_resp({}, status=200))
    with patch("httpx.AsyncClient.post", new=post), patch("httpx.AsyncClient.put", new=put):
        asset = await client.upload_file(data=b"bytes", content_type="image/webp", filename="x.webp")
    assert asset == "https://asset/x.webp"
    assert put.call_args.kwargs["headers"]["x-h"] == "v"
    assert put.call_args.kwargs["headers"]["Content-Type"] == "image/webp"
