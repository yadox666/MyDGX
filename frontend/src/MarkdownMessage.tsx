import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

function resolvedAssetUrl(src: string | undefined, assetBaseUrl: string | undefined) {
  if (!src || !assetBaseUrl || /^(?:https?:|data:|blob:)/i.test(src)) return src;
  try {
    return new URL(src.replace(/^\.?\//, ""), assetBaseUrl).toString();
  } catch {
    return undefined;
  }
}

const MarkdownMessage = memo(function MarkdownMessage({
  content,
  assetBaseUrl,
}: {
  content: string;
  assetBaseUrl?: string;
}) {
  return (
    <div className="markdown-message">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{
          a: ({ href, children, ...props }) => (
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {children}
            </a>
          ),
          img: ({ src, alt, ...props }) => (
            <img
              {...props}
              src={resolvedAssetUrl(src, assetBaseUrl)}
              alt={alt || ""}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownMessage;
