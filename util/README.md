# util/ — runtime files of the halugraph server

While `halugraph` runs for this project it keeps its runtime files here:

| file | what |
|---|---|
| `halugraph.sock` | the unix socket the agent's client (`tools/cmd/halugraph-client`) talks to. When the project path is too long for a socket path, the socket lives in the system temp folder instead (`instance.json` says where). |
| `instance.json` | who is running: process id, project root, URL and port, socket path, halugraph version, start time. halugraph uses it to refuse a second server for the same project; the client uses it to find the server. |

Both files are created on start, removed on a clean shutdown, and ignored by git. If halugraph crashed,
stale files are detected and replaced on the next start — you never need to edit or delete them by hand.

Do not put your own files here.
