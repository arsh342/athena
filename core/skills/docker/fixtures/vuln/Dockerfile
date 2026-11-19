FROM node # EXPECT docker.runs-as-root, docker.floating-base-tag
ADD https://example.org/app.tgz /app # EXPECT docker.add-remote-url
RUN curl -fsSL https://example.org/i.sh | sh # EXPECT docker.curl-pipe-shell
