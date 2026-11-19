import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportsDir = path.join(workspace, 'reports');
const openapi = JSON.parse(fs.readFileSync(path.join(reportsDir, 'openapi.json'), 'utf8'));
const crawl = JSON.parse(fs.readFileSync(path.join(reportsDir, 'crawl-summary.json'), 'utf8'));

const paths = [];
for (const [p, methods] of Object.entries(openapi.paths || {})) {
  for (const [method, op] of Object.entries(methods)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method.toLowerCase())) continue;
    const reqBody = op.requestBody?.content
      ? Object.entries(op.requestBody.content).map(([ct, v]) => ({
          contentType: ct,
          schema: v.schema?.$ref || v.schema?.type || v.schema
        }))
      : null;
    const params = (op.parameters || []).map(pr => ({
      name: pr.name,
      in: pr.in,
      required: !!pr.required,
      type: pr.schema?.type || pr.schema?.$ref || null
    }));
    paths.push({
      method: method.toUpperCase(),
      path: p,
      tags: op.tags || [],
      summary: op.summary || '',
      operationId: op.operationId || '',
      security: op.security || null,
      params,
      requestBody: reqBody
    });
  }
}

const byTag = {};
for (const item of paths) {
  const tag = item.tags[0] || 'untagged';
  (byTag[tag] ??= []).push(item);
}

const out = {
  info: openapi.info,
  securitySchemes: openapi.components?.securitySchemes || null,
  schemasCount: Object.keys(openapi.components?.schemas || {}).length,
  schemaNames: Object.keys(openapi.components?.schemas || {}),
  totalEndpoints: paths.length,
  byTag,
  jwtInfo: crawl.jwtInfo,
  authTests: crawl.authTests,
  pages: (crawl.pagesSummary || [])
    .filter(p => !p.route.includes('uploaded_page=') && !p.route.includes('pending_page=') && !p.route.includes('document_page='))
    .map(p => ({
      route: p.route,
      finalPath: p.finalPath,
      status: p.status,
      title: p.title,
      headings: p.headings,
      forms: p.forms,
      buttons: (p.buttons || []).filter(b => b.text || b.onclick),
      controls: p.controls,
      linksSample: (p.links || []).slice(0, 40)
    }))
};

fs.writeFileSync(path.join(reportsDir, 'openapi-summary.json'), JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify({
  info: out.info,
  securitySchemes: out.securitySchemes,
  totalEndpoints: out.totalEndpoints,
  tags: Object.fromEntries(Object.entries(byTag).map(([k, v]) => [k, v.length])),
  schemasCount: out.schemasCount,
  uniquePagesCount: out.pages.length
}, null, 2));
