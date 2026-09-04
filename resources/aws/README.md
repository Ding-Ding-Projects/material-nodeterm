AWS CLI v2 installer resource slot

The application checks this packaged directory for the exact versioned AWS CLI user MSI before
using the verified official AWS fetch fallback. The MSI is intentionally not checked into ordinary
source history because it is a large third-party binary. A packaging job may place the pinned
`AWSCLIV2-User-2.36.31.msi` resource here through the repository's approved large-artifact transfer
path. The runtime still hashes the bytes and refuses any mismatch.
