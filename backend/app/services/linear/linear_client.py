"""Minimal async Linear GraphQL client for feedback forwarding.

Per-request httpx clients (no shared client) to match the project's
event-loop-safety convention. Authorization uses the raw personal/api
key (Linear personal keys are sent without a 'Bearer ' prefix).

NOTE: GraphQL field names target the Linear API as of 2026-05. Verify
against https://developers.linear.app if a mutation 400s.
"""

from typing import Any

import httpx

_ENDPOINT = "https://api.linear.app/graphql"


class LinearError(RuntimeError):
    """Raised when the Linear API returns GraphQL errors."""


class LinearClient:
    def __init__(self, api_key: str, team_id: str) -> None:
        self.api_key = api_key
        self.team_id = team_id

    async def _graphql(self, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                _ENDPOINT,
                json={"query": query, "variables": variables},
                headers={"Authorization": self.api_key, "Content-Type": "application/json"},
                timeout=30.0,
            )
            resp.raise_for_status()
            payload = resp.json()
        if payload.get("errors"):
            raise LinearError(str(payload["errors"]))
        return payload["data"]

    async def create_issue(
        self, *, title: str, description: str, priority: int, label_ids: list[str]
    ) -> dict[str, Any]:
        query = (
            "mutation IssueCreate($input: IssueCreateInput!) {"
            " issueCreate(input: $input) {"
            " success issue { id identifier url } } }"
        )
        data = await self._graphql(
            query,
            {
                "input": {
                    "teamId": self.team_id,
                    "title": title,
                    "description": description,
                    "priority": priority,
                    "labelIds": label_ids,
                }
            },
        )
        return data["issueCreate"]["issue"]

    async def update_issue_description(self, issue_id: str, description: str) -> None:
        query = (
            "mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {"
            " issueUpdate(id: $id, input: $input) { success } }"
        )
        await self._graphql(query, {"id": issue_id, "input": {"description": description}})

    async def _team_labels(self) -> dict[str, str]:
        query = (
            "query TeamLabels($id: String!) {"
            " team(id: $id) { labels(first: 250) { nodes { id name } } } }"
        )
        data = await self._graphql(query, {"id": self.team_id})
        return {n["name"]: n["id"] for n in data["team"]["labels"]["nodes"]}

    async def _create_label(self, name: str) -> str:
        query = (
            "mutation LabelCreate($input: IssueLabelCreateInput!) {"
            " issueLabelCreate(input: $input) { success issueLabel { id name } } }"
        )
        data = await self._graphql(query, {"input": {"teamId": self.team_id, "name": name}})
        return data["issueLabelCreate"]["issueLabel"]["id"]

    async def resolve_labels(self, names: list[str]) -> list[str]:
        """Map label names to ids, creating any that don't exist yet."""
        existing = await self._team_labels()
        ids: list[str] = []
        for name in names:
            label_id = existing.get(name)
            if label_id is None:
                label_id = await self._create_label(name)
            ids.append(label_id)
        return ids

    async def upload_file(self, *, data: bytes, content_type: str, filename: str) -> str:
        """Upload bytes into Linear's file storage; return the permanent assetUrl."""
        query = (
            "mutation FileUpload($contentType: String!, $filename: String!, $size: Int!) {"
            " fileUpload(contentType: $contentType, filename: $filename, size: $size) {"
            " success uploadFile { uploadUrl assetUrl headers { key value } } } }"
        )
        result = await self._graphql(
            query, {"contentType": content_type, "filename": filename, "size": len(data)}
        )
        upload = result["fileUpload"]["uploadFile"]
        headers = {h["key"]: h["value"] for h in upload["headers"]}
        headers["Content-Type"] = content_type
        async with httpx.AsyncClient() as client:
            put = await client.put(upload["uploadUrl"], content=data, headers=headers, timeout=60.0)
            put.raise_for_status()
        return upload["assetUrl"]
