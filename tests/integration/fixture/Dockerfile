FROM docker:29.9.3-dind
RUN apk add --no-cache openssh-server bash nginx curl shadow iproute2 nodejs npm python3 git
COPY boot.sh /boot.sh
RUN chmod +x /boot.sh
ENTRYPOINT ["/boot.sh"]
