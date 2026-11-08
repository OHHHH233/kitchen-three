export async function loadCompressedGltf(loader, {
  url,
  fallbackUrl,
  expectedBytes,
  onProgress,
  cache = 'default',
}) {
  if (!url || typeof DecompressionStream !== 'function') {
    return loader.loadAsync(fallbackUrl, onProgress);
  }

  const response = await fetch(url, {cache});
  if (!response.ok) throw new Error(`模型下载失败：HTTP ${response.status}`);
  if (!response.body) throw new Error('浏览器无法读取模型下载流');

  let loaded = 0;
  const headerBytes = Number(response.headers.get('content-length'));
  const total = headerBytes || expectedBytes || 0;
  const progressStream = new TransformStream({
    transform(chunk, controller) {
      loaded += chunk.byteLength;
      onProgress?.({loaded, total, lengthComputable: total > 0});
      controller.enqueue(chunk);
    },
  });
  const decodedStream = response.body
    .pipeThrough(progressStream)
    .pipeThrough(new DecompressionStream('gzip'));
  const bytes = await new Response(decodedStream).arrayBuffer();
  return loader.parseAsync(bytes, '');
}
