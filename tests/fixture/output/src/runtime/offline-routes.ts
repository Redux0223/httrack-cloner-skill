export interface OfflineRoute {
  match?: string;
  prefix?: string;
  methods?: string[];
  status?: number;
  json?: unknown;
  headers?: Record<string, string>;
}

const offlineRoutes: OfflineRoute[] = [
  {
    "match": "/__offline__/api.example.test/join",
    "methods": [
      "POST"
    ],
    "status": 200,
    "json": {
      "success": true
    }
  },
  {
    "match": "/__offline__/analytics.example.test/collect",
    "methods": [
      "POST"
    ],
    "status": 204,
    "json": null
  }
];

export default offlineRoutes;
