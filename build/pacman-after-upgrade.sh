# pacman-only: what runs on `pacman -U` OVER an existing installation.
#
# 🔴 Measured 2026-09-18 on a fresh CachyOS container, release package 2.0.1: pacman runs
# `post_install` on the first install only. A reinstall or upgrade calls `post_upgrade`, and
# fpm writes that function only when it is given `--after-upgrade`. Without it, the second
# `pacman -U` extracted a fresh zerotier-one (extended attributes are not part of the
# package) and nothing granted the capability again:
#
#     getcap …/resources/zerotier/x64/zerotier-one   -> 0 lines   (was cap_net_admin=eip)
#     stat -c %a …/chrome-sandbox                     -> 755       (was 4755)
#
# The first line costs the Remote-ID route; the second costs EVERY start on a machine without
# unprivileged user namespaces (Chromium aborts, exit 133). `.deb` and `.rpm` do not have this
# gap: dpkg runs postinst on every configure, rpm runs %post on upgrade as well.
#
# This is not a script of its own. fpm pastes it into the same `.INSTALL` file that holds the
# macro-substituted `post_install`, so calling that function is the whole job — the paths and
# the ZeroTier grant stay defined in exactly one place, build/linux-after-install.sh.
#
# pacman calls `post_upgrade <new-version> <old-version>`; post_install ignores its arguments.
post_install "$@"
