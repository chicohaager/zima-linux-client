# ZimaOS Client

Desktop client for ZimaOS on Linux — files, photos, apps and device management, with ZeroTier
built in and Tailscale used when it is already there.

> **Branch `v2` · version 2.0.1 · latest release
> [`v2.0.1`](https://github.com/chicohaager/zima-linux-client/releases/tag/v2.0.1) (2026-08-31)**
> — a rewrite of the client. The 0.9.x line lives on `main` and under
> [`legacy-0.9/`](legacy-0.9/); nothing was deleted.
>
> What is built and what is measured, with the command behind each claim:
> [`docs/V2-STATUS.md`](docs/V2-STATUS.md) (German). Deutsche Fassung dieser Datei:
> [`liesmich.md`](liesmich.md).

Every claim in this repository's documentation names the command or the measurement behind it.
Where something is unmeasured, it says so instead of sounding finished.

---

## Screenshots

Taken from the current build by `npm run screenshots` on 2026-09-17, against the recorded device
the end-to-end suite replays. Nothing is staged and nothing is retouched — see
[About these pictures](#about-these-pictures).

**Three ways in, side by side** — scan the network, type an address, or hand it a Remote ID.

![The device screen before signing in: scan the local network, connect via IP address, connect via Remote ID](docs/img/01-connect.png)

**Device** — who you are signed in as, which path is in use, how long the session is valid,
and what the device can do.

![The device screen: signed in over a direct IP, session validity, the detected features, model and system info](docs/img/02-device.png)

**Files** — volumes, breadcrumb, search, upload and download, trash with restore.

![The files screen showing volumes, a breadcrumb, search, the toolbar and the folder listing](docs/img/03-files.png)

**Photos** — the library, the device's indexing progress, and a foreground backup of local
folders that says on screen that it only runs while the window is open.

![The photos screen: 104 of 104 indexed, a search field, the photo backup panel, and the thumbnail grid](docs/img/04-photos.png)

The flat colour tiles are not a rendering fault: the recorded device serves placeholder image
bytes, because a fixture that carried real photographs would carry somebody's real photographs.

**Apps** — what is installed, with its own icon, its port and its state.

![The apps screen with app cards, each with icon, running state, port, open and stop controls](docs/img/05-apps.png)

**Dark theme** — light, dark, or follow the system: three states, so "follow the system" stays
reachable.

![The same device screen in the dark theme](docs/img/06-dark.png)

**Narrow window** — a floating pill below 860 px, a labelled sidebar above it. Two component
trees, not one restyled.

![The files screen in a narrow window, with the navigation as a floating pill at the bottom](docs/img/07-narrow.png)

### About these pictures

- **The device is a recording**, `e2e/fixtures/zimaos-session.json`, scrubbed by
  `e2e/scrub-fixture.mjs`: file and folder names are replaced wholesale, addresses, e-mail
  addresses and tokens rewritten. That is why the folders are called `Ordner-1` and the apps
  `App 223` — those pictures cannot show anyone's real files, because the only device involved
  has none.
- **The capture runs with an empty home directory and without Tailscale on `PATH`**, and a guard
  refuses to write any picture that shows an address other than the replayed one, a tailnet, or a
  home path — [`scripts/screenshot-guard.mjs`](scripts/screenshot-guard.mjs), with its own tests.
- **The capture machine has no keyring.** The client says so before anything is stored and asks
  what to do; the pictures show the state after answering "ask every time". On a desktop with a
  working keyring that question never comes up.

---

## What it does

**Getting in — three ways, side by side**

- **Scan the local network** — mDNS over `_zimaos._tcp`, implemented directly against the wire
  format, no third-party dependency.
- **Connect by IP address** — for devices the scan does not reach.
- **Connect by Remote ID** — the device's ZeroTier network ID. Joining the network, deriving the
  device address and probing it happens in one step. If you moved the device's WebUI port away
  from 80, enter it next to the Remote ID — over the tunnel there is no mDNS to read it from.

The scheme is never guessed from the port: a device on port 443 is addressed as plain HTTP first,
and only the device's own answer that the port speaks TLS switches it to HTTPS. Every candidate
address goes through the same probe, and a named reason comes back instead of an empty list.

**Once connected**

- **Files** — browse, search, create folders, upload and download, transfer tasks, trash with
  restore, pinned folders.
- **Photos** — gallery and folder grid, search, the device's indexing progress, and a foreground
  backup of local folders that lists every skipped file with its reason.
- **Apps** — installed apps with their own icons, start and stop, open in the client or in the
  browser.
- **Device** — model and system info, CPU/memory utilisation, volumes, power actions.
- **Several devices** — a registry with priorities, switching, and forgetting a device including
  its session. A device that shows up at an address nobody stored is recognised and offered:
  "Is this your device?"
- **Import from 0.9** — reads the old client's configuration read-only. No secrets are migrated;
  v2 asks for the password once instead.

**Around all of that**

- **28 languages**, 295 keys. `en_US` and `de_DE` are complete; the other 26 sit at 290 and fall
  back to English for the rest, which the i18n gate reports rather than hides. Only `de_DE`,
  `en_US` and `en_GB` have been reviewed; the others are machine-translated and marked
  "unreviewed" in the language menu.
- **ZeroTier ships with the client**, as its own binary under
  `/opt/ZimaOS Client/resources/zerotier/<arch>/`, granted `CAP_NET_ADMIN` during installation.
  Nothing is downloaded, and an existing system-wide ZeroTier is left untouched.
- **Tailscale is detected, never operated.** If a tunnel is already running it is used. Nothing
  is started, stopped or reconfigured, and no DNS setting is touched.
- **Only the refresh token is stored, never the password** — in the system keyring. Without a
  keyring the client asks before writing anything, rather than saving with Electron's hardcoded
  fallback password.

## What it deliberately does not do

- **No background synchronisation.** Photo backup runs while the window is open, and stops with it.
- **No SMB/CIFS mounting and no scheduled backup jobs.** Both existed in the 0.9 line and are
  not part of this rewrite.
- **No automatic updates.** A new version arrives as a new package.
- **It does not take over your tunnel**, and **it does not connect on its own**: a saved device is
  reached when you press **Connect**, not at start-up. Which network you are on is your decision.

## Installation

Packages are shipped for **x86_64 only** — no arm64, no Flatpak. (An arm64 `.deb` builds and
installs, but nobody has seen the application start on arm64 — it cannot be shown under
emulation. That is a settled decision, not a pending task.)

The packages live in the
[**release v2.0.1**](https://github.com/chicohaager/zima-linux-client/releases/tag/v2.0.1).
Fetch the installer, the checksums and the one package for your distribution:

```bash
cd ~/Downloads
B=https://github.com/chicohaager/zima-linux-client/releases/download/v2.0.1

wget $B/install.sh $B/SHA256SUMS-2.0.1.txt          # always these two

wget $B/zima-linux-client_2.0.1_amd64.deb           # Debian, Ubuntu, Zorin, Mint, Pop!_OS
wget $B/zima-linux-client-2.0.1.x86_64.rpm          # Fedora, openSUSE, RHEL derivatives
wget $B/zima-linux-client-2.0.1.pacman              # Arch, Manjaro

chmod +x install.sh && sudo ./install.sh
```

[`install.sh`](scripts/install.sh) compares the checksum, picks the package matching your
distribution, installs it with the right tool and then **measures** whether the application can
start — registration, placement, Chromium's sandbox, `CAP_NET_ADMIN` for the bundled ZeroTier,
AppArmor profile. It never launches anything. `--check` inspects without changing anything and
needs no sudo, `--repair` fixes what is fixable, `--uninstall` removes it.

By hand instead:

```bash
sha256sum -c SHA256SUMS-2.0.1.txt   # OK for the file you downloaded

# Debian, Ubuntu, Zorin, Linux Mint, Pop!_OS — apt needs an absolute path or a leading ./
sudo apt install ~/Downloads/zima-linux-client_2.0.1_amd64.deb

# Fedora
sudo dnf install ./zima-linux-client-2.0.1.x86_64.rpm

# openSUSE — the package is unsigned, hence the two flags
sudo zypper --no-gpg-checks install --allow-unsigned-rpm ./zima-linux-client-2.0.1.x86_64.rpm

# Arch, Manjaro
sudo pacman -U ./zima-linux-client-2.0.1.pacman
```

**AppImage** — nothing is installed and none of the permissions above are set. GitHub replaces the
space in the file name with a dot, so it downloads as:

```bash
chmod +x ZimaOS.Client-2.0.1.AppImage
./ZimaOS.Client-2.0.1.AppImage
```

Installation goes to `/opt/ZimaOS Client/`, with `/usr/bin/zima-linux-client` as the entry point.

## Requirements

- **x86_64 Linux** with a desktop session. On problematic DRM drivers the client relaunches
  itself under X11 — measured on `vmwgfx`, where Wayland ends in SIGSEGV.
- **`.deb` declares twelve dependencies** — the nine electron-builder declares by default, plus
  `libasound2t64 | libasound2` and `libgbm1`, plus `libcap2-bin` for the post-install's `setcap`.
- **The AppImage is type 2 and needs FUSE 2** (`libfuse2t64` on Ubuntu 24.04).
- **A keyring is expected but not required** — see above.

The deb, rpm and pacman packages of 2.0.0 were **installed and started on nine distributions** by
[`scripts/distro-matrix.sh`](scripts/distro-matrix.sh) on 2026-08-15 — Ubuntu 22.04, 24.04 and
26.04 LTS, Debian 12 and 13, Fedora 41 and 44, Arch and openSUSE Tumbleweed — each in the real
path, as an ordinary user, with the sandbox on. On real desktops: Ubuntu 24.04 (GNOME on
Wayland), Zorin OS 18, and three third-party reports (Fedora KDE, PikaOS, Ubuntu) documented in
[`docs/V2-STATUS.md`](docs/V2-STATUS.md).

## Building from source

Requires **Node.js 22 or newer**.

```bash
git clone https://github.com/chicohaager/zima-linux-client.git
cd zima-linux-client
git checkout v2
npm install

npm run dev               # development mode
npm run dev:x11           # same, forced onto X11
npm run build             # type-check + production build

npm run package:deb       # .deb      — no extra tooling needed
npm run package:rpm       # .rpm      — needs rpmbuild   (apt install rpm)
npm run package:pacman    # .pacman   — needs bsdtar     (apt install libarchive-tools)
npm run package:appimage  # .AppImage
npm run package:tar       # .tar.gz
npm run package:linux     # the five above at once
```

## Verification

```bash
npm run verify          # type-check · lint · tests · build · build gate · i18n gate · privacy gate
npm test                # 360 tests in 45 files (2026-09-17)
npm run test:e2e        # 5 end-to-end flows in the real window, against the recorded device
npm run screenshots     # the pictures above, from the current build
npm run verify:build    # reads the BUILT files: preload is CJS, sandbox on, CSP without unsafe-eval
npm run verify:i18n     # completeness, unknown keys, placeholder drift, "English copy" detection
npm run verify:privacy  # no LAN addresses, user names or e-mail addresses in tracked files
npm run verify:live     # reads against a real device, with the same parsers the IPC handlers use
npm run verify:release  # are dist/ artefacts this commit's build? — and lists open issues/PRs
```

Check the exit code, not the output: `npm run verify | tail` discards the gate's return value.

## Architecture

Electron 43 · React 19 · Vite 7 · electron-vite 5 · Tailwind 4 · zod 4 · TanStack Query ·
zustand · i18next · electron-log · Vitest 3 · TypeScript 5.9.

- **A hard process boundary**: renderer with `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, a CSP without `unsafe-eval`, every window opening decided explicitly.
- **A typed IPC contract** (`src/shared/contract.ts`): one zod schema per channel, answers always
  wrapped as `{ok:true,value} | {ok:false,error}`.
- **`Result<T,E>` instead of exceptions**, with error kinds kept apart: `refused` ≠ `timeout` ≠
  `dns` ≠ `unexpected-status`.
- **The preload is CJS and dependency-free** — a sandboxed preload cannot load ESM.

```
src/
├── main/            # Electron main process: devices, discovery (mDNS), ipc, legacy import,
│                    # media, secrets, tailscale (read-only), transport, zerotier, zima (API)
├── preload/         # the CJS bridge
├── renderer/src/    # React UI: features/, i18n/, shared/, styles/
└── shared/          # contract, channels, result, domain types
```

## License

MIT License — see LICENSE.

## Author

Holger Kühn

## Links

- **Repository**: https://github.com/chicohaager/zima-linux-client
- **Issues**: https://github.com/chicohaager/zima-linux-client/issues
- **Releases**: https://github.com/chicohaager/zima-linux-client/releases
- **ZimaOS**: https://www.zimaspace.com

---

## ☕ Support

If this project saves you time, you can buy me a coffee — it keeps the side projects going.

<!-- bmc-button -->
[![Buy Me A Coffee](https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=%E2%98%95&slug=holgi18114&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff)](https://buymeacoffee.com/holgi18114)

… or scan the code:

<a href="https://buymeacoffee.com/holgi18114"><img src=".github/bmc-qr.png" alt="Buy Me a Coffee QR code" width="160"></a>
