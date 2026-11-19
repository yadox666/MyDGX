# Safe conversion to server mode

MyDGX includes an operation to convert a desktop Ubuntu/DGX OS installation
into a system without a graphical session. The public entry point is
`./start.sh serverize`, which delegates the work to `scripts/serverize-os.sh`.

The operation is designed to preserve the machine's compute and administration
role: the two most recent kernels, the running kernel if it is older
than those two, firmware, NVIDIA drivers, CUDA, networking, SSH, Avahi/mDNS,
Docker, Ollama, and the MyDGX services. Earlier kernels, and the packages
tied to that version, are removed when applying.

## Audit without changes

The default mode only queries `dpkg`, APT, Snap, and systemd. It builds the
list of candidates, simulates the full APT resolution, and rejects the plan if
a protected package shows up.

```bash
./start.sh serverize
```

It can also be requested explicitly:

```bash
./start.sh serverize --audit
```

The audit also shows which kernels would be kept and which packages from
earlier versions would be purged. It doesn't need administrator privileges and
doesn't uninstall packages, stop services, change the systemd target, or
write state to `/var`.

## Initial phase: disable only

This option reduces memory usage without deleting applications, packages, snaps, or
data. It is reversible and doesn't free disk space:

```bash
sudo ./start.sh serverize \
  --disable \
  --confirm DISABLE-DESKTOP-SERVICES
```

The initial phase:

- changes the default boot target to `multi-user.target`;
- enables the `tty1` text console;
- stops and disables GDM/display manager, Bluetooth, printing,
  ModemManager, `switcheroo-control`, `colord`, and `whoopsie` when present;
- keeps networking, SSH, Avahi, NVIDIA/CUDA, Docker, Ollama, and MyDGX;
- saves the previous state under `/var/lib/mydgx/serverize/`;
- doesn't invoke `apt remove`, `apt purge`, `autoremove`, or `snap remove`.

The stopped processes free memory immediately; no reboot is needed.
The next boot will also be to the console.

Run this operation from SSH or a TTY. The script asks `loginctl` for the
type of the session that launched it, because `sudo` discards `XDG_SESSION_TYPE`, and
only continues if it is `tty`. That way it doesn't close its own graphical terminal during the
change.

To re-enable the desktop without reinstalling anything:

```bash
sudo systemctl set-default graphical.target
sudo systemctl enable --now gdm3.service
```

The other disabled services can be restored selectively by checking
`enabled-services-before.txt` in the state directory created by the operation.

## Applying

Always review the audit before applying. The conversion requires root and a
literal confirmation to prevent accidental runs:

```bash
sudo ./start.sh serverize \
  --apply \
  --confirm CONVERT-TO-HEADLESS-SERVER
```

The script:

1. verifies the consistency of `dpkg` and APT;
2. simulates the plan again and checks the protected list;
3. saves the previous inventory;
4. marks critical components so APT doesn't treat them as orphans;
5. configures `multi-user.target` and enables the `tty1` console;
6. removes desktop applications, metapackages, and services;
7. runs `autoremove --purge` with the same arguments as the simulation;
8. purges kernels older than the two most recent, along with headers,
   modules, tools, and NVIDIA modules of that same version;
9. verifies that the preserved services that were running are still active
   (including all `mydgx-*` units, their timers, and Open WebUI), that the MyDGX
   dependencies are still installed, that `nvidia-smi` responds, and that
   the running kernel and the other preserved kernel are still installed.

The simulation uses `--no-upgrade` and is rejected if APT proposes installing or
upgrading any package; the conversion only removes packages.

It doesn't reboot the machine. Rebooting and checking the HDMI console remain
separate, deliberate actions.

## What gets removed

Candidates are calculated from the packages actually installed. They include:

- GNOME, GDM, sessions, extensions, portals, and graphical utilities;
- LibreOffice, Firefox, Thunderbird, and multimedia or office applications;
- desktop tools for networking, files, backup, printing, and scanning;
- Snap Store and known desktop snaps;
- Bluetooth, printing, ModemManager, color management, and desktop telemetry when
  installed;
- NVIDIA/DGX metapackages and customizations exclusive to the desktop;
- NVIDIA's official DGX Dashboard (`dgx-dashboard`) and the initial
  setup `dgx-oobe`; MyDGX keeps working, and its DGX
  Dashboard check now shows as unavailable, without being required;
- kernels older than the latest two, with their `linux-*` packages of that
  version: image, headers, modules, tools, and associated NVIDIA modules.

Snaps unrelated to the desktop are not removed. `snapd` is kept because it is
part of Ubuntu Server's dependencies.

After removing the desktop snaps, `--apply` also removes the bases
and content layers left unused (`gnome-*`, `mesa-*`,
`gtk-common-themes`, `core*`, and `bare`). A base is kept if any snap that
is still installed uses it as `base:` or has its content connected. The
audit shows that list in removal order. At the end, the copies that no longer
belong to any installed snap are deleted from `/var/lib/snapd/cache`;
without that step, the space isn't freed.

Old (`disabled`) revisions can be removed at any time without
removing the applications:

```bash
snap list --all | awk 'NR > 1 && $NF ~ /disabled/ {print $1, $3}' |
  while read -r name rev; do sudo snap remove "$name" --revision="$rev"; done
sudo find /var/lib/snapd/cache -maxdepth 1 -type f -links 1 -delete
```

## What is kept

The protection explicitly covers:

- the two most recent kernels and, if it isn't among them, the running
  kernel; also its initrd, modules, and packages of that version;
- `linux-*-hwe-*` metapackages, firmware, systemd, boot, and `dgxstation-grub`;
- NVIDIA drivers, modules, utilities, and libraries;
- CUDA, cuDNN, and TensorRT;
- NetworkManager, Netplan, SSH, and Avahi;
- Docker, containerd, and Ollama;
- Ubuntu Server base packages;
- all the system dependencies installed by `deploy.sh` (read from its
  `base_packages` list), plus Node.js, `avahi-utils`, Docker, and NVIDIA
  Container Toolkit. Without them, the frontend build, updates from GitHub,
  and mDNS device discovery would fail;
- the packages that applications installed outside APT depend on.

### Applications installed by the user

Before simulating, `--audit` and `--apply` scan `/home`, `/root`, `/opt`,
`/usr/local`, and `/srv`. From there they protect:

- the packages that provide the system libraries linked by
  ELF binaries, `.so` libraries, and native `.node` modules (with `readelf`);
- the interpreter of each Python virtual environment (`pyvenv.cfg`);
- the interpreter of scripts located in `bin` directories, according to their
  `#!` line;
- the executable of user services in `~/.config/systemd/user`.

The audit shows the resulting list. Without `sudo` it can't read other
users' homes or `/root`, so it's a good idea to also review it with
`sudo ./start.sh serverize --audit`.

The scan doesn't see libraries that an application opens at runtime
by name (for example, with `ctypes` or `dlopen`), nor system programs
it invokes by their path. To keep a specific package, add
`--keep PACKAGE`; it can be repeated and works for `--audit` and `--apply`:

```bash
sudo ./start.sh serverize --apply --confirm CONVERT-TO-HEADLESS-SERVER \
  --keep libreoffice-core --keep gimp
```

Avahi stays active because administration using `.local` names
depends on mDNS.

### Preserved X components

The system stops starting GDM, GNOME, and X, but it may keep packages such as
`xserver-xorg-core`, `xserver-xorg-input-libinput`, and
`xserver-xorg-video-nvidia-*`. The official NVIDIA driver metapackages
depend on them; if the input driver were removed, APT would install another one in
its place. Removing them would also remove the compute
driver and hurt future updates.

Those components remain installed but inactive; the boot target is
`multi-user.target`.

## Old kernels

`--audit` lists the installed images and marks each one as kept or
removable. `--disable` doesn't uninstall kernels. `--apply` does purge the old ones
after validating the plan.

The selection works like this:

- the installed `linux-image-<version>-<flavor>` images are sorted;
- the two highest versions are kept;
- if the running kernel is older than those two, it is kept too,
  so the system is never left without the kernel that is loaded;
- with one or two kernels installed, none are removed.

For each removed version, the `linux-*` packages whose name
contains its ABI are removed. On a DGX Spark that includes, for example,
`linux-image-6.11.0-1016-nvidia`, `linux-headers-6.11.0-1016-nvidia`,
`linux-tools-6.11.0-1016-nvidia`, `linux-modules-nvidia-fs-6.11.0-1016-nvidia`,
and `linux-nvidia-6.11-tools-6.11.0-1016`.

That list doesn't include firmware, CUDA, the NVIDIA user-space drivers, or the
metapackages that track the HWE kernel, such as
`linux-image-nvidia-hwe-24.04` or `linux-modules-nvidia-595-open-nvidia-hwe-24.04`.

Before purging, the script simulates `apt-get purge` and aborts if APT tries to
remove any package that isn't on the list. The running kernel
stays loaded. Uninstalling regenerates GRUB, but the script doesn't reboot.

## Previous state and recovery

Before modifying packages, a directory with a UTC date is created under:

```text
/var/lib/mydgx/serverize/
```

It contains the `dpkg` inventory, manually marked packages, the previous target,
enabled and active services, snaps, candidates, and the APT simulation. The
files are only accessible by root.

### Local JSON report

When `--disable` or `--apply` finishes successfully, the script confirms the
result with a readable summary:

```text
You freed 1.80 GiB of RAM and 6.25 GiB of disk space.
```

It then shows the location of the detailed report, created as:

```text
data/serverize-DATE-OPERATION.json
```

The report contains:

- bytes used on disk before and after, the difference, and the space freed;
- total and available memory before and after, with their difference;
- number of packages and snaps installed before and after;
- previous and current systemd target;
- selected services active before and after, and which ones were disabled;
- mode run, completion time, and path to the previous inventory;
- running kernel, kept kernels and, only with `--apply`, removed kernel
  versions and packages.

The report uses `schema_version` 2. An old version 1 report doesn't include
the `kernels` object.

The disk metrics describe the file system that contains MyDGX. Available
memory may vary slightly due to concurrent activity, so
its difference is an observation of the system and not an exclusive accounting
for each process.

The JSON has local read permissions and contains no environment variables,
credentials, keys, tokens, or configuration file contents.

There is no automatic restore, because versions and repositories may
change. To recover the desktop, first review the saved inventory and
reinstall the metapackages available for that DGX OS version. At a minimum,
recovery usually requires:

```bash
sudo apt-get install ubuntu-desktop nvidia-system-station
sudo systemctl set-default graphical.target
```

Reboot only after checking that APT finished without errors and that the
NVIDIA driver is still working.

## Post-conversion verification

After applying, and before rebooting:

```bash
systemctl get-default
systemctl is-active ssh NetworkManager avahi-daemon docker mydgx
nvidia-smi
```

After the reboot, HDMI should show a text console on `tty1`. SSH access and the
MyDGX web interface should also remain available.

## Security notes

- Run the apply step from a local console or with alternative access to the
  machine, even though SSH is protected by the script.
- Don't modify the list of protected packages without simulating APT again.
- Kernel cleanup doesn't replace that simulation: if the `apt-get
  purge` plan includes a package that doesn't belong to an old kernel, the operation
  stops before uninstalling.
- The script doesn't read, copy, or display `.env`, SSH keys, tokens, or credentials.
- Don't use `--apply` during APT updates, driver installations, or
  `dpkg` repairs.
