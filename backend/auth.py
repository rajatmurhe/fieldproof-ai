import os

from dotenv import load_dotenv
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from clerk_backend_api import AuthenticateRequestOptions, Clerk, authenticate_request

from backend.database.connection import get_db
from backend.models.organization import Organization
from backend.models.user import User

load_dotenv()


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    secret_key = os.getenv("CLERK_SECRET_KEY")

    if not secret_key:
        raise HTTPException(
            status_code=500,
            detail="CLERK_SECRET_KEY is not configured.",
        )

    authorized_parties = [
        value.strip()
        for value in os.getenv("CLERK_AUTHORIZED_PARTIES", "").split(",")
        if value.strip()
    ]

    try:
        request_state = authenticate_request(
            request,
            AuthenticateRequestOptions(
                secret_key=secret_key,
                authorized_parties=authorized_parties,
                accepts_token=["session_token"],
            ),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication request.",
        ) from exc

    if not request_state.is_signed_in:
        reason = getattr(
            request_state,
            "message",
            None,
        ) or "Authentication required."

        raise HTTPException(
            status_code=401,
            detail=str(reason),
        )

    payload = request_state.payload or {}

    clerk_user_id = payload.get("sub")

    if not clerk_user_id:
        raise HTTPException(
            status_code=401,
            detail="Authenticated token does not contain a user ID.",
        )

    try:
        clerk = Clerk(bearer_auth=secret_key)

        clerk_user = clerk.users.get(
            user_id=clerk_user_id,
        )

        memberships = clerk.users.get_organization_memberships(
            user_id=clerk_user_id,
            limit=100,
        )

    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not retrieve Clerk user or organization information.",
        ) from exc

    membership_data = getattr(
        memberships,
        "data",
        memberships,
    )

    if not membership_data:
        raise HTTPException(
            status_code=403,
            detail="Authenticated Clerk user does not belong to an organization.",
        )

    active_clerk_org_id = (
        payload.get("org_id")
        or payload.get("organization_id")
    )

    selected_membership = None

    if active_clerk_org_id:
        for membership in membership_data:
            organization = getattr(
                membership,
                "organization",
                None,
            )

            organization_id = getattr(
                organization,
                "id",
                None,
            )

            if organization_id == active_clerk_org_id:
                selected_membership = membership
                break

    if selected_membership is None and len(membership_data) == 1:
        selected_membership = membership_data[0]

    if selected_membership is None:
        raise HTTPException(
            status_code=403,
            detail="Could not determine the active Clerk organization.",
        )

    clerk_organization = getattr(
        selected_membership,
        "organization",
        None,
    )

    clerk_org_id = getattr(
        clerk_organization,
        "id",
        None,
    )

    clerk_org_name = getattr(
        clerk_organization,
        "name",
        None,
    )

    clerk_org_slug = getattr(
        clerk_organization,
        "slug",
        None,
    )

    if not clerk_org_id:
        raise HTTPException(
            status_code=403,
            detail="Authenticated organization information is incomplete.",
        )

    organization = (
        db.query(Organization)
        .filter(
            Organization.clerk_org_id == clerk_org_id,
        )
        .first()
    )

    if not organization:
        organization = (
            db.query(Organization)
            .filter(
                Organization.slug == clerk_org_slug,
            )
            .first()
        )

    if not organization:
        organization = Organization(
            name=clerk_org_name or "FieldProof Organization",
            slug=clerk_org_slug or clerk_org_id,
            clerk_org_id=clerk_org_id,
        )

        db.add(organization)
        db.flush()

        from backend.api_checklists import _seed_defaults_for_org
        _seed_defaults_for_org(db, organization.id)

    first_name = getattr(
        clerk_user,
        "first_name",
        None,
    )

    last_name = getattr(
        clerk_user,
        "last_name",
        None,
    )

    full_name = " ".join(
        part
        for part in [first_name, last_name]
        if part
    ).strip()

    email_addresses = getattr(
        clerk_user,
        "email_addresses",
        [],
    )

    primary_email_id = getattr(
        clerk_user,
        "primary_email_address_id",
        None,
    )

    email = None

    for email_address in email_addresses:
        if getattr(email_address, "id", None) == primary_email_id:
            email = getattr(
                email_address,
                "email_address",
                None,
            )
            break

    if not email and email_addresses:
        email = getattr(
            email_addresses[0],
            "email_address",
            None,
        )

    if not email:
        raise HTTPException(
            status_code=403,
            detail="Authenticated Clerk user does not have an email address.",
        )

    if not full_name:
        full_name = email.split("@")[0]

    membership_role = getattr(
        selected_membership,
        "role",
        "org:member",
    )

    local_role = (
        "ADMIN"
        if membership_role in {"org:admin", "org:owner"}
        else "REVIEWER"
    )

    user = (
        db.query(User)
        .filter(
            User.clerk_user_id == clerk_user_id,
        )
        .first()
    )

    if not user:
        user = (
            db.query(User)
            .filter(
                User.email == email,
            )
            .first()
        )

    if not user:
        user = User(
            organization_id=organization.id,
            name=full_name,
            email=email,
            clerk_user_id=clerk_user_id,
            role=local_role,
        )

        db.add(user)

    else:
        user.organization_id = organization.id
        user.name = full_name
        user.email = email
        user.clerk_user_id = clerk_user_id
        user.role = local_role

    db.commit()
    db.refresh(user)

    return user
