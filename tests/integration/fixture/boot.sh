#!/bin/sh
set -e
ssh-keygen -A
printf 'root:%s\n' "$SPQA_PASSWORD" | chpasswd
mkdir -p /run/sshd
printf '\nPermitRootLogin yes\nPasswordAuthentication yes\n' >> /etc/ssh/sshd_config
if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
  mkdir -p /sys/fs/cgroup/init
  while read -r pid; do
    echo "$pid" > /sys/fs/cgroup/init/cgroup.procs 2>/dev/null || true
  done < /sys/fs/cgroup/cgroup.procs
  sed 's/[^ ][^ ]*/+&/g' /sys/fs/cgroup/cgroup.controllers > /sys/fs/cgroup/cgroup.subtree_control
fi
dockerd --host=unix:///var/run/docker.sock --storage-driver=overlay2 --bip=172.29.245.1/24 --iptables=false --ip6tables=false --ip-forward=false --ip-masq=false > /var/log/spqa-docker.log 2>&1 &
exec /usr/sbin/sshd -D -e
