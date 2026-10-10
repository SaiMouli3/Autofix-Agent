import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Agent replies are Markdown. react-markdown never renders raw HTML from the text and strips
 *  unsafe link protocols (javascript:, data:), so model output cannot inject markup. */
export function Markdown({ children, className = "prose" }: { children: string; className?: string }) {
  return (
    <div className={`${className} md`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
          table: ({ node: _n, ...props }) => <div className="table-wrap"><table className="table" {...props} /></div>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
