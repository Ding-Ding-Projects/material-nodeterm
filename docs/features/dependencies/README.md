# Dependency installation

The dependency installer is the shared foundation for node features. It keeps a versioned,
auditable manifest and a machine-local lifecycle service so a node can explain exactly why it is
unavailable, offer **Install and continue**, and resume the interrupted flow after verification.

## Articles

| Article | Scope |
| --- | --- |
| [Automatic node dependency installation](./automatic-node-dependencies.md) | Manifest fields, bounded lifecycle, installation, repair, and host integration. |
| [Bundled AWS CLI v2](./aws-cli-v2.md) | Pinned MSI resource, verified fallback, version probe, and installed model inventory. |

