# Runbook: court-day freeze

Owner: Engineering lead
Last drilled: not yet drilled

This page is a cross-link. The freeze procedure and its pipeline controls are owned by #100 (staging and
production deploy pipelines); when that lands, its content replaces the pointers below.

## Purpose

Avoid deploys and risky maintenance while advocates rely on CauseDeck: court-day windows are 07:00-10:30 and
18:00-23:00 IST.

## Triggers

A deploy, migration, key rotation or restore drill is planned inside a court-day window, or an incident
happens inside one (every `window=court-day` alert is handled as P0, see [on-call](on-call.md)).

## Roles

Engineering lead decides exceptions; the on-call primary executes.

## Steps

1. Schedule changes outside the windows. Scheduled key rotations ([key-rotation](key-rotation.md)) and
   drills run between 10:30 and 18:00 IST.
2. For an emergency change inside a window, the engineering lead approves it in the incident ticket.

## Communications

Post a status page notice before any emergency change inside a window. No automated outbound messages go to
third parties; notices are sent by a human after approval.

## Evidence

The approval and the change record in the incident ticket.

## Verification

The deploy pipeline from #100 refuses a deploy inside a window without an override.

## After action

Review every in-window change in the weekly review.
