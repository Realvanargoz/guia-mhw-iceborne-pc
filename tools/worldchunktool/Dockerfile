# syntax=docker/dockerfile:1
# Builds mhvuze/WorldChunkTool FROM SOURCE (no prebuilt binaries) at a pinned commit,
# applies the reviewed patch (worldchunktool.patch) and publishes a self-contained
# single-file Windows x64 exe.
#
#   docker build --output type=local,dest=tools/bin tools/worldchunktool
#
# Result: tools/bin/WorldChunkTool.exe  (needs an Oodle DLL next to it at runtime; see README.md)
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
ARG WCT_REPO=https://github.com/mhvuze/WorldChunkTool
# Pinned upstream commit: "More keys, add decompress size estimate" (2020-01-21), v1.2.2
ARG WCT_SHA=2ad4fc848c84e7df742ee38eca0f3b5f7a677ab0
WORKDIR /src
RUN git init -q . \
 && git remote add origin "$WCT_REPO" \
 && git fetch -q --depth 1 origin "$WCT_SHA" \
 && git checkout -q FETCH_HEAD \
 && test "$(git rev-parse HEAD)" = "$WCT_SHA"
# Upstream sources are CRLF; the patch is made against LF-normalized files.
RUN find WorldChunkTool -type f \( -name '*.cs' -o -name '*.csproj' \) -exec sed -i 's/\r$//' {} +
COPY worldchunktool.patch /tmp/
RUN git apply -p1 --whitespace=nowarn /tmp/worldchunktool.patch && git status --short
RUN dotnet publish WorldChunkTool/WorldChunkTool.csproj -c Release -r win-x64 --self-contained \
      -p:PublishSingleFile=true -o /out \
 && cp README.md /out/WorldChunkTool.UPSTREAM_README.md \
 && ls -la /out

FROM scratch
COPY --from=build /out/WorldChunkTool.exe /out/WorldChunkTool.UPSTREAM_README.md /
