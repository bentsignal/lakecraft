import assert from "node:assert/strict";
import {
  claimTokenFromPreviewResponse,
  parsePreviewMetadata,
  previewRequestBody,
} from "../scripts/publish-lakebed-preview.mjs";

const response = {
  deployId: "dep_Test123",
  claimUrl: "https://api.lakebed.dev/claim/dep_Test123/preview-secret-token",
};
assert.equal(claimTokenFromPreviewResponse(response), "preview-secret-token");
assert.equal(claimTokenFromPreviewResponse({ ...response, claimUrl: "https://api.lakebed.dev/claim/dep_Other/token" }), null);
assert.equal(claimTokenFromPreviewResponse({
  claimUrl: "https://api.lakebed.dev/claim/anonymous_Test123/preview-secret-token",
  deployId: "anonymous_Test123",
}), "preview-secret-token", "anonymous preview ids remain opaque URL-safe Lakebed identifiers");

assert.deepEqual(parsePreviewMetadata(JSON.stringify({
  api: "https://api.lakebed.dev",
  claimToken: "preview-secret-token",
  deployId: "dep_Test123",
  url: "https://test-123.lakebed.app",
})), {
  api: "https://api.lakebed.dev",
  claimToken: "preview-secret-token",
  deployId: "dep_Test123",
  url: "https://test-123.lakebed.app",
});
assert.throws(() => parsePreviewMetadata(JSON.stringify({
  api: "https://api.lakebed.dev",
  claimToken: "preview-secret-token",
  deployId: "dep_Test123",
  url: "https://example.com",
})), /unexpected app URL/);
assert.equal(parsePreviewMetadata(JSON.stringify({
  api: "https://api.lakebed.dev",
  claimToken: "preview-secret-token",
  deployId: "anonymous_Test123",
  url: "https://test-123.lakebed.app",
})).deployId, "anonymous_Test123", "new anonymous deploy ids remain reusable preview metadata");

const body = JSON.parse(previewRequestBody({
  artifact: { createdWith: { lakebed: "0.0.29" }, format: "lakebed.capsule.artifact.v1" },
  clientBundle: "Y2xpZW50",
  artifactHash: "ignored",
}));
assert.deepEqual(Object.keys(body).sort(), ["artifact", "clientBundle", "clientVersion"]);
assert.equal(body.clientVersion, "0.0.29");
assert.equal("artifactHash" in body, false);

console.log("Lakebed preview metadata and deploy-envelope safety tests passed");
