# Approved relay peers

When somebody joins your canvas over the relay, both sides confirm a short code and you approve
their device once. That approval is **durable**: it is pinned to disk so the same device does not
have to ask again on every reconnect.

Which means it needs a way back out, and for a while it had none — the revoke existed and nothing
could reach it. Approving a device was a one-way door.

**Settings → Phone → Approved relay peers** lists what is currently pinned and revokes it.

## Revoking does two things, and reports them separately

A revoke un-pins the device *and* cuts any session it currently holds. Those can fail
independently, so they are reported independently rather than collapsed into one tick:

- if the un-pin could not be written, the row stays and says the device **may still reconnect
  without being asked again** — retry;
- if the live session could not be confirmed cut, it says exactly that.

The row is never removed from the list on any failure path. A revoke that half-worked must not
look like one that worked, because the whole reason to open this screen is to be sure.

## A peer can never revoke anyone

The revoke and the listing are both **local-only**: they are refused over the relay before the
handler is entered. An approved peer has real access to the session they joined, but the list of
who may reach this machine is not theirs to read or to edit.

## Not the same as paired devices

The **Paired devices** list directly above is a different thing: LAN pairing over SSH, with its
own registry and its own revoke. They sit together because a user asking "who can reach this
machine?" should find one screen and not two, but neither list governs the other.

## Surfaces

| | |
| --- | --- |
| **Desktop** | Full. |
| **Server Edition** | Not applicable — it hosts no relay, and the whole Phone screen says so. |
| **Relay tabs** | A relay tab manages its own local approvals, not the host's. |
