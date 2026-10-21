#!/bin/sh
# Endurecimiento del servidor propio de ODB (21/10/2026). Se corre como root en el
# servidor y se puede volver a correr: deja todo igual si ya está.
#   scp infra/servidor/aprovisionar.sh root@SERVIDOR: && ssh root@SERVIDOR sh aprovisionar.sh
# Cada bloque dice qué control de ISO/IEC 27001:2022 (Anexo A) cubre.
set -eu
export DEBIAN_FRONTEND=noninteractive
LLAVE_AUTORIZADA="$(head -1 /root/.ssh/authorized_keys)"

echo "== paquetes (A.8.8 vulnerabilidades, A.8.15 registros, A.8.13 backups)"
apt-get -y -qq install auditd audispd-plugins unattended-upgrades fail2ban lynis restic ufw >/dev/null

echo "== usuario sin privilegios para operar y publicar (A.5.15, A.8.2 acceso privilegiado)"
if ! id odb >/dev/null 2>&1; then useradd -m -s /bin/bash -G docker odb; fi
install -d -m 700 -o odb -g odb /home/odb/.ssh
grep -qxF "$LLAVE_AUTORIZADA" /home/odb/.ssh/authorized_keys 2>/dev/null || echo "$LLAVE_AUTORIZADA" >> /home/odb/.ssh/authorized_keys
chown odb:odb /home/odb/.ssh/authorized_keys && chmod 600 /home/odb/.ssh/authorized_keys
cat > /etc/sudoers.d/odb <<'EOF'
# odb opera el servidor; todo lo que hace con sudo queda registrado (A.8.15)
Defaults:odb logfile="/var/log/sudo-odb.log", log_input, log_output
odb ALL=(ALL) NOPASSWD: ALL
EOF
chmod 440 /etc/sudoers.d/odb && visudo -cf /etc/sudoers.d/odb >/dev/null

echo "== SSH endurecido (A.8.5 autenticación segura, A.8.20 redes)"
cat > /etc/ssh/sshd_config.d/00-odb-solo-llave.conf <<'EOF'
# ODB: solo se entra con llave. La clave de root queda para la consola web de Akamai.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PermitEmptyPasswords no
MaxAuthTries 3
LoginGraceTime 30
MaxStartups 10:30:60
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
PermitTunnel no
LogLevel VERBOSE
KexAlgorithms sntrup761x25519-sha512@openssh.com,curve25519-sha256,curve25519-sha256@libssh.org
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com
EOF
sshd -t
systemctl reload ssh

echo "== auditoría del sistema (A.8.15 registros, A.8.16 monitoreo)"
cat > /etc/audit/rules.d/odb.rules <<'EOF'
# quién cambia usuarios, permisos y la configuración sensible
-w /etc/passwd -p wa -k identidad
-w /etc/group -p wa -k identidad
-w /etc/shadow -p wa -k identidad
-w /etc/sudoers -p wa -k privilegios
-w /etc/sudoers.d/ -p wa -k privilegios
-w /etc/ssh/sshd_config -p wa -k ssh
-w /etc/ssh/sshd_config.d/ -p wa -k ssh
-w /root/.ssh/ -p wa -k llaves
-w /home/odb/.ssh/ -p wa -k llaves
-w /srv/odb/secretos/ -p rwa -k secretos
-w /srv/odb/docker-compose.yml -p wa -k despliegue
-w /etc/docker/ -p wa -k docker
-w /usr/bin/docker -p x -k docker
-w /var/log/sudo-odb.log -p wa -k privilegios
-a always,exit -F arch=b64 -S execve -F euid=0 -F auid>=1000 -F auid!=unset -k comandos_root
EOF
augenrules --load >/dev/null 2>&1 || true
systemctl enable --now auditd >/dev/null 2>&1

echo "== registros persistentes con retención (A.8.15)"
install -d /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/odb.conf <<'EOF'
[Journal]
Storage=persistent
SystemMaxUse=1G
MaxRetentionSec=180day
EOF
systemctl restart systemd-journald
timedatectl set-ntp true

echo "== núcleo y red (A.8.9 configuración segura, A.8.20 redes)"
cat > /etc/sysctl.d/90-odb.conf <<'EOF'
vm.swappiness=10
kernel.kptr_restrict=2
kernel.dmesg_restrict=1
kernel.unprivileged_bpf_disabled=1
kernel.yama.ptrace_scope=1
fs.protected_hardlinks=1
fs.protected_symlinks=1
fs.suid_dumpable=0
net.ipv4.tcp_syncookies=1
net.ipv4.conf.all.rp_filter=1
net.ipv4.conf.default.rp_filter=1
net.ipv4.conf.all.accept_redirects=0
net.ipv4.conf.default.accept_redirects=0
net.ipv4.conf.all.send_redirects=0
net.ipv4.conf.default.send_redirects=0
net.ipv4.conf.all.accept_source_route=0
net.ipv6.conf.all.accept_redirects=0
net.ipv6.conf.default.accept_redirects=0
net.ipv4.conf.all.log_martians=1
EOF
sysctl --system >/dev/null

echo "== firewall (A.8.20): solo SSH y web"
ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
ufw limit 22/tcp >/dev/null
ufw --force enable >/dev/null

echo "== bloqueo de intentos (A.8.16)"
cat > /etc/fail2ban/jail.d/odb.local <<'EOF'
[sshd]
enabled = true
maxretry = 4
findtime = 10m
bantime = 1h
EOF
systemctl restart fail2ban

echo "== parches automáticos, con reinicio a las 5:00 si hace falta (A.8.8)"
cat > /etc/apt/apt.conf.d/52odb-unattended <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "05:00";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF

echo "== Docker endurecido (A.8.9): sin escalar privilegios, contenedores vivos al reiniciar Docker"
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "3" },
  "no-new-privileges": true,
  "live-restore": true,
  "userland-proxy": false,
  "icc": false
}
EOF
if ! cmp -s /etc/docker/daemon.json /etc/docker/daemon.json.aplicado 2>/dev/null; then
  systemctl restart docker && cp /etc/docker/daemon.json /etc/docker/daemon.json.aplicado
fi

echo "== permisos de lo sensible (A.8.3, A.5.33)"
chmod 700 /srv/odb/secretos 2>/dev/null || true
chmod 600 /srv/odb/secretos/*.env 2>/dev/null || true
chmod 750 /srv/odb 2>/dev/null || true
chown -R root:docker /srv/odb 2>/dev/null || true
chown -R 1000:1000 /srv/odb/secretos/archivos 2>/dev/null || true
chmod 600 /etc/ssh/sshd_config.d/*.conf

echo "== actualizaciones y herramientas de control (A.8.8, A.8.16, A.8.32)"
apt-get -y -qq -o Dpkg::Options::=--force-confold upgrade >/dev/null
apt-get -y -qq install libpam-tmpdir debsums apt-show-versions sysstat acct aide >/dev/null
sed -i 's/^ENABLED="false"/ENABLED="true"/' /etc/default/sysstat 2>/dev/null || true
systemctl enable --now sysstat acct >/dev/null 2>&1 || true

echo "== integridad de archivos (A.8.16): AIDE con revisión diaria"
# sin los datos que cambian solos: si no, AIDE recorre las capas de Docker
# (un procesador entero y 770 MB durante decenas de minutos, 21/10/2026)
cat > /etc/aide/aide.conf.d/99_odb_exclusiones <<'EOM'
!/var/lib/docker
!/var/lib/containerd
!/srv/odb/codigo
!/srv/odb/codigo.anterior
!/var/log
!/swapfile
!/tmp
!/var/tmp
!/var/cache
!/var/lib/apt
!/var/lib/sysstat
!/var/lib/odb-vigia
!/var/account
EOM
if [ ! -f /var/lib/aide/aide.db ]; then
  (nice -n 19 ionice -c3 aideinit -y -f >/var/log/aide-init.log 2>&1 &)
fi
systemctl enable --now dailyaidecheck.timer >/dev/null 2>&1 || true

echo "== protocolos y USB que no se usan (A.8.9, A.7.10)"
cat > /etc/modprobe.d/odb-sin-uso.conf <<'EOM'
install dccp /bin/false
install sctp /bin/false
install rds /bin/false
install tipc /bin/false
install usb-storage /bin/false
EOM

echo "== sin volcados de memoria con datos (A.8.11) y permisos más estrictos (A.8.3)"
cat > /etc/security/limits.d/odb.conf <<'EOM'
* hard core 0
EOM
sed -i 's/^UMASK\s.*/UMASK\t\t027/' /etc/login.defs
sed -i 's/^PASS_MAX_DAYS\s.*/PASS_MAX_DAYS\t365/; s/^PASS_MIN_DAYS\s.*/PASS_MIN_DAYS\t1/' /etc/login.defs

echo "== aviso legal de acceso (A.5.10)"
cat > /etc/issue.net <<'EOM'
Sistema privado de O.D.B Premium Market. Acceso solo para personas autorizadas.
Toda actividad queda registrada.
EOM
cp /etc/issue.net /etc/issue
grep -q "^Banner /etc/issue.net" /etc/ssh/sshd_config.d/00-odb-solo-llave.conf || echo "Banner /etc/issue.net" >> /etc/ssh/sshd_config.d/00-odb-solo-llave.conf
sshd -t && systemctl reload ssh

echo "listo"
