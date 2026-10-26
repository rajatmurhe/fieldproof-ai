"""
FieldProof AI — Video Storage

Videos are stored under server-generated, organization-scoped keys:

    {organization_id}/{job_pk}-{random}{ext}

The client never chooses where a file is written or which file is served,
so one tenant cannot read or overwrite another tenant's video by guessing
or reusing a filename.

Backends:
  - LocalStorage (default): files under UPLOAD_DIR. Fine for local dev and
    docker-compose; NOT durable on free PaaS tiers with ephemeral disks.
  - SupabaseStorage: used when SUPABASE_URL and SUPABASE_SERVICE_KEY are set.
    Free tier, durable, survives restarts and spin-downs.
"""

import logging
import os
import shutil
import tempfile
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Protocol

import httpx
from fastapi import HTTPException
from fastapi.responses import FileResponse, Response, StreamingResponse

logger = logging.getLogger("fieldproof.storage")

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads"))

MEDIA_TYPES: dict[str, str] = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
}


def build_storage_key(organization_id: int, job_pk: int, extension: str) -> str:
    return f"{organization_id}/{job_pk}-{uuid.uuid4().hex}{extension.lower()}"


def media_type_for(key: str) -> str:
    return MEDIA_TYPES.get(Path(key).suffix.lower(), "application/octet-stream")


class VideoStorage(Protocol):
    def put_file(self, key: str, source: Path) -> None: ...

    def exists(self, key: str) -> bool: ...

    def delete(self, key: str) -> None: ...

    @contextmanager
    def local_path(self, key: str) -> Iterator[Path]: ...

    def response(self, key: str, filename: str) -> Response: ...


class LocalStorage:
    def __init__(self, root: Path):
        self.root = root

    def _path(self, key: str) -> Path:
        root = self.root.resolve()
        path = (root / key).resolve()

        # Keys are server-generated, but never trust that blindly.
        if root not in path.parents:
            raise ValueError(f"Storage key escapes upload root: {key!r}")

        return path

    def put_file(self, key: str, source: Path) -> None:
        destination = self._path(key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), destination)

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    @contextmanager
    def local_path(self, key: str) -> Iterator[Path]:
        path = self._path(key)
        if not path.is_file():
            raise FileNotFoundError(f"Video not found in storage: {key}")
        yield path

    def response(self, key: str, filename: str) -> Response:
        path = self._path(key)
        if not path.is_file():
            raise HTTPException(
                status_code=404,
                detail="Video file is not available on this server.",
            )

        # FileResponse supports HTTP Range requests, so the browser can seek.
        return FileResponse(
            path=path,
            media_type=media_type_for(key),
            headers={
                "Content-Disposition": f'inline; filename="{filename}"',
                "Cache-Control": "private, no-store",
            },
        )


class SupabaseStorage:
    def __init__(self, url: str, service_key: str, bucket: str):
        self.base = f"{url.rstrip('/')}/storage/v1/object"
        self.bucket = bucket
        self.headers = {
            "Authorization": f"Bearer {service_key}",
            "apikey": service_key,
        }

    def _url(self, key: str) -> str:
        return f"{self.base}/{self.bucket}/{key}"

    def put_file(self, key: str, source: Path) -> None:
        with source.open("rb") as body:
            response = httpx.post(
                self._url(key),
                headers={
                    **self.headers,
                    "Content-Type": media_type_for(key),
                    "x-upsert": "true",
                },
                content=body,
                timeout=300,
            )
        response.raise_for_status()
        source.unlink(missing_ok=True)

    def exists(self, key: str) -> bool:
        response = httpx.head(self._url(key), headers=self.headers, timeout=30)
        return response.status_code == 200

    def delete(self, key: str) -> None:
        httpx.delete(
            f"{self.base}/{self.bucket}",
            headers=self.headers,
            json={"prefixes": [key]},
            timeout=30,
        )

    @contextmanager
    def local_path(self, key: str) -> Iterator[Path]:
        # Gemini's Files API needs a local file, so download to a temp file.
        handle, temp_name = tempfile.mkstemp(suffix=Path(key).suffix)
        temp_path = Path(temp_name)

        try:
            with os.fdopen(handle, "wb") as out, httpx.stream(
                "GET", self._url(key), headers=self.headers, timeout=300
            ) as response:
                if response.status_code == 404:
                    raise FileNotFoundError(f"Video not found in storage: {key}")
                response.raise_for_status()
                for chunk in response.iter_bytes():
                    out.write(chunk)

            yield temp_path
        finally:
            temp_path.unlink(missing_ok=True)

    def response(self, key: str, filename: str) -> Response:
        client = httpx.Client(timeout=300)
        upstream = client.send(
            client.build_request("GET", self._url(key), headers=self.headers),
            stream=True,
        )

        if upstream.status_code != 200:
            upstream.close()
            client.close()
            raise HTTPException(status_code=404, detail="Video not found.")

        def body() -> Iterator[bytes]:
            try:
                yield from upstream.iter_bytes()
            finally:
                upstream.close()
                client.close()

        return StreamingResponse(
            body(),
            media_type=media_type_for(key),
            headers={
                "Content-Disposition": f'inline; filename="{filename}"',
                "Cache-Control": "private, no-store",
            },
        )


def get_storage() -> VideoStorage:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_KEY")

    if supabase_url and supabase_key:
        return SupabaseStorage(
            supabase_url,
            supabase_key,
            os.getenv("SUPABASE_BUCKET", "videos"),
        )

    return LocalStorage(UPLOAD_DIR)
