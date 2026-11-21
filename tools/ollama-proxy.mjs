// Прокси для показа через туннель: Ollama отклоняет запросы, у которых адрес не localhost,
// поэтому прокси подменяет адрес на localhost:11434 и передаёт ответ как есть (потоком).
import http from "node:http";

const PORT = 8080;
http.createServer((req, res) => {
  const headers = { ...req.headers, host: "localhost:11434" };
  const upstream = http.request(
    { host: "127.0.0.1", port: 11434, method: req.method, path: req.url, headers },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    }
  );
  upstream.on("error", () => { res.writeHead(502); res.end("Ollama недоступна"); });
  req.pipe(upstream);
}).listen(PORT, "127.0.0.1", () => console.log(`proxy on ${PORT}`));
