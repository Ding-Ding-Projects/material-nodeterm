# Publishing a nodeterm host through a Cloudflare Tunnel

Use this instead of the `tls` compose profile when the machine reaches the internet **outbound
only** — a home LAN, a NAT'd box, a Raspberry Pi behind a router. There is no inbound 80/443 for
Caddy to answer an ACME challenge on, and there does not need to be: the tunnel terminates TLS at
Cloudflare's edge and dials out from the host.

## The shape

```
  phone / browser  ──https──▶  Cloudflare edge  ──tunnel──▶  cloudflared (on your host)
                                                                  │  plain HTTP, inside the LAN
                                                                  ▼
                                                          nodeterm-server:8443
```

nodeterm speaks plain HTTP to cloudflared, exactly as it would to Caddy. That is safe for the same
reason: the hop never touches a public interface. The server sets the `Secure` cookie flag itself
once it sees `X-Forwarded-Proto: https`, which Cloudflare sends.

## 1. Let the tunnel reach the container

The default `docker-compose.yml` binds to `127.0.0.1` only. If `cloudflared` runs **on the same
host** — the usual case — that is already reachable, because loopback is loopback. Point the
tunnel at `http://127.0.0.1:8443`.

If `cloudflared` runs in its own container on a different Docker network, give it a route in by
publishing on the host's LAN address instead:

```bash
echo 'NODETERM_BIND=192.168.0.10' >> .env      # this host's LAN address, not 0.0.0.0
./host.sh
```

Then the tunnel's service URL is `http://192.168.0.10:8443`.

**Do not set `NODETERM_BIND=0.0.0.0`.** That publishes an unauthenticated-until-you-log-in shell
server on every interface the machine has, including whatever your router might forward. The
whole point of the tunnel is that you do not need to.

## 2. Add the public hostname

A tunnel started with `--token` (the copy-paste one Cloudflare gives you) keeps its routes **in
the Cloudflare dashboard**, not in a local file — so this step cannot be done by editing anything
on the host:

1. Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels**
2. Pick the tunnel, **Configure** → **Public Hostname** → **Add a public hostname**
3. Subdomain / domain: the name you want, e.g. `dew` + `dewhui.uk`
4. Service: **HTTP** → `127.0.0.1:8443` (or the LAN address from step 1)
5. Save. The DNS record is created for you.

If the tunnel instead runs from a `config.yml`, add the route there and restart it:

```yaml
ingress:
  - hostname: dew.example.uk
    service: http://127.0.0.1:8443
  - service: http_status:404          # keep this catch-all last
```

## 3. WebSockets must be allowed to upgrade

The canvas is not a page that loads and sits there — every terminal's output, the agent-status
stream and the whole live session ride a WebSocket at `/ws`. Cloudflare proxies WebSockets by
default; if the page loads but nothing ever appears, check **Network → WebSockets** is enabled on
the zone. That failure reads as "the app is broken" rather than "the upgrade was dropped", which
is why it is worth checking first.

## 4. Lock it down, because it is now on the internet

A nodeterm host serves interactive shells. Once it has a public hostname, anyone who reaches it
gets the login page, and anyone who gets past the login page gets your machine. At minimum:

- **Use a passkey**, and keep the password as the fallback it is meant to be.
- Put **Cloudflare Access** in front of the hostname (Zero Trust → Access → Applications) so an
  identity check happens before a request ever reaches the tunnel. This is the single highest-value
  thing on this list: it means an unauthenticated request never touches your host at all.
- Do not reuse the first-boot seed password. Change it after the first login.

## Verifying it actually works

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://your.hostname/login    # expect 200
```

`/login` is served without auth precisely so it can be probed. If that returns 200 over HTTPS from
off your network, the tunnel is routing. If it returns 530 or 1033, the tunnel is up but the
hostname is not routed to it — recheck step 2.
