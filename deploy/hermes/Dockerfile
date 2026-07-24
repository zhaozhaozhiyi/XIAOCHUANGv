FROM ghcr.io/astral-sh/uv:0.11.6-python3.13-trixie@sha256:b3c543b6c4f23a5f2df22866bd7857e5d304b67a564f4feab6ac22044dde719b AS base

ENV PYTHONUNBUFFERED=1 \
    PATH="/opt/hermes/.venv/bin:${PATH}" \
    HOME=/home/hermes \
    HERMES_HOME=/tmp/hermes \
    XIAOCHUANG_SKILLS_ROOT=/opt/xiaochuang-skills

RUN groupadd --gid 10000 hermes \
    && useradd --uid 10000 --gid hermes --create-home --home-dir /home/hermes hermes

WORKDIR /opt/hermes

COPY deploy/hermes/.build/hermes-agent/pyproject.toml deploy/hermes/.build/hermes-agent/uv.lock ./
RUN touch README.md \
    && uv sync --frozen --no-install-project --extra messaging

COPY deploy/hermes/.build/hermes-agent/ ./
RUN uv pip install --no-cache-dir --no-deps -e .

COPY skills/xiaochuang_runtime_policy/ /opt/xiaochuang-skills/xiaochuang_runtime_policy/
COPY skills/drama_source_understanding/ /opt/xiaochuang-skills/drama_source_understanding/
COPY skills/drama_episode_planning/ /opt/xiaochuang-skills/drama_episode_planning/
COPY skills/drama_episode_script_writing/ /opt/xiaochuang-skills/drama_episode_script_writing/
COPY skills/drama_story_graph_build/ /opt/xiaochuang-skills/drama_story_graph_build/
COPY skills/drama_storyboard_planning/ /opt/xiaochuang-skills/drama_storyboard_planning/
COPY deploy/hermes/config.yaml /opt/xiaochuang-runtime/config.yaml
COPY --chmod=0755 deploy/hermes/entrypoint.sh /usr/local/bin/xiaochuang-hermes

RUN chown -R hermes:hermes /home/hermes /opt/hermes /opt/xiaochuang-runtime \
    && chmod -R a+rX /opt/hermes /opt/xiaochuang-runtime /opt/xiaochuang-skills \
    && chmod -R a-w /opt/xiaochuang-skills

FROM base AS test

USER 10000:10000

RUN uv sync --frozen --extra messaging --extra dev

FROM base AS runtime

USER 10000:10000

ENTRYPOINT ["/usr/local/bin/xiaochuang-hermes"]
