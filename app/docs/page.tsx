import SwaggerUI from "swagger-ui-react";
import type { Metadata } from "next";
import "swagger-ui-react/swagger-ui.css";

export const metadata: Metadata = {
  title: "Blum Agent API 文档",
  description: "百隆五金智能助手 API 文档 - OpenAPI 3.0",
};

export default function ApiDocs() {
  return (
    <div style={{ padding: "20px", maxWidth: "1200px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "20px" }}>
        Blum Agent API 文档
      </h1>
      <p style={{ color: "#666", marginBottom: "20px" }}>
        基于 OpenAPI 3.0 规范。文档地址：<a href="/openapi.json">/openapi.json</a>
      </p>
      <SwaggerUI url="/openapi.json" />
    </div>
  );
}
