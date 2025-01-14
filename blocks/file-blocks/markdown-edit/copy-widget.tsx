import { syntaxTree } from "@codemirror/language";
import {
  CharCategory,
  EditorSelection,
  EditorState,
  Extension,
  StateField,
  Range,
  RangeSet,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  KeyBinding,
  WidgetType,
} from "@codemirror/view";
import { FileContext, FolderContext } from "@githubnext/blocks";

interface HtmlWidgetParams {
  url: string;
  context: FileContext | FolderContext;
}

export class HtmlWidget extends WidgetType {
  readonly text;
  readonly context;

  constructor({ text, context }: HtmlWidgetParams) {
    super();

    this.text = text;
    this.context = context;
  }

  eq(htmlWidget: HtmlWidget) {
    return htmlWidget.text === this.text;
    return htmlWidget.context === this.context;
  }

  toDOM() {
    const container = document.createElement("span");
    container.className = "cm-html-container";
    const srcStringsRegex = /src="([^"]*)"/g;
    const parsedText = this.text.replace(srcStringsRegex, (match, p1) => {
      const url = parseImageUrl(p1, this.context);
      return `src="${url}"`;
    });
    container.innerHTML = parsedText;
    return container;
  }

  ignoreEvent(_event: Event): boolean {
    return false;
  }
}
export const parseUrl = (url: string, context: FileContext | FolderContext) => {
  if (url.startsWith("/")) {
    return `https://github.com/${context.owner}/${context.repo}/${url}`;
  } else {
    return url;
  }
};
export const copy = ({
  context,
  onScrollTo,
}: {
  context: FileContext | FolderContext;
  onScrollTo: (from) => void;
}): Extension => {
  const headerDecoration = ({ level, id }: { level: string; id: string }) =>
    Decoration.line({
      class: `cm-copy-header cm-copy-header--${level}`,
      attributes: {
        id,
      },
    });
  const htmlTagDecoration = ({
    text,
    context,
  }: {
    text: string;
    context: FileContext | FolderContext;
  }) =>
    Decoration.widget({
      widget: new HtmlWidget({ text, context }),
    });
  const htmlTagTextDecoration = () =>
    Decoration.mark({
      class: "cm-copy-html-tag",
    });
  const instructionDecoration = () =>
    Decoration.mark({
      class: "cm-instruction",
    });
  const rawLinkDecoration = (url: string) =>
    Decoration.mark({
      tagName: "a",
      class: "cm-copy-link-raw",
      attributes: {
        href: url.startsWith("#") ? "javascript:void(0)" : url,
        target: "_top",
        onclick: url.startsWith("#")
          ? `window.scrollToHash("${slugifyId(url.slice(1))}"); return false`
          : `window.open('${url}', '_blank'); return false;`,
      },
    });
  const linkAltDecoration = (text: string, linkText: string, url: string) =>
    Decoration.mark({
      tagName: "a",
      class: "cm-copy-link-alt",
    });
  const linkDecoration = (text: string, linkText: string, url: string) =>
    Decoration.mark({
      tagName: "a",
      class: "cm-copy-link",
      attributes: {
        href: url.startsWith("#") ? "javascript:void(0)" : url,
        target: "_top",
        onclick: url.startsWith("#")
          ? `window.scrollToHash("${slugifyId(url.slice(1))}"); return false`
          : `window.open('${url}', '_blank'); return false;`,
        title: linkText,
      },
    });
  const horizontalRuleDecorationAfter = () =>
    Decoration.mark({
      class: "cm-copy-hr",
    });
  const blockquoteDecoration = () =>
    Decoration.line({
      class: "cm-copy-blockquote",
    });
  const codeBlockStartDecoration = () =>
    Decoration.line({
      class: "cm-code-start",
    });
  const codeBlockDecoration = () =>
    Decoration.line({
      class: "cm-code",
    });
  const tableDecoration = () =>
    Decoration.mark({
      class: "cm-table",
    });
  const listItemDecoration = (listType, index) =>
    Decoration.line({
      class: `cm-list-item cm-list-item--${listType}`,
      attributes: {
        "data-index": index,
      },
    });

  const decorate = (state: EditorState) => {
    const widgets: Range<Decoration>[] = [];
    window.scrollToHash = (hash: string) => {
      let element = document.getElementById(hash);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        const fullText = state.doc.toString();
        const headings = fullText.match(/^#+\s*(.*)$/gm);
        const matchingLink = headings.find((heading) => {
          return slugifyHeading(heading) === hash;
        });
        if (matchingLink) {
          const index = fullText.indexOf(matchingLink);
          onScrollTo(index);
        }
      }
    };

    const tree = syntaxTree(state);
    tree.iterate({
      enter: ({ type, from, to }) => {
        if (from === undefined || to === undefined) return;
        if (type.name.startsWith("ATXHeading")) {
          const text = state.doc.sliceString(from, to);
          const level = type.name.split("Heading")[1];
          let id = slugifyHeading(text);
          const newDecoration = headerDecoration({ level, id });
          widgets.push(newDecoration.range(state.doc.lineAt(from).from));
        } else if (type.name === "SetextHeading2") {
          const newDecoration = horizontalRuleDecorationAfter();
          widgets.push(newDecoration.range(from, to));
        } else if (type.name === "Link") {
          const text = state.doc.sliceString(from, to);
          const linkRegex = /\[.*?\]\((?<url>.*?)\)/;
          const url = linkRegex.exec(text)?.groups?.url;
          const linkTextRegex = /\[(?<text>.*?)\]/;
          const linkText = linkTextRegex.exec(text)?.groups?.text || "";
          if (url) {
            const absoluteUrl = parseUrl(url, context);
            const newAltDecoration = linkAltDecoration(
              text,
              linkText,
              absoluteUrl
            );
            const altIndexStart = from + text.indexOf(linkText);
            widgets.push(
              newAltDecoration.range(
                altIndexStart,
                altIndexStart + linkText.length
              )
            );
            const newDecoration = linkDecoration(text, linkText, absoluteUrl);
            widgets.push(newDecoration.range(from, to));
          }
        } else if (type.name === "CodeInfo") {
          let text = state.doc.sliceString(from, to);
          const newDecoration = instructionDecoration();
          widgets.push(newDecoration.range(from, to));
        } else if (type.name === "URL") {
          let text = state.doc.sliceString(from, to);
          const endOfLink = /\)/.exec(text);
          to = endOfLink ? from + endOfLink.index + 1 : to;
          text = state.doc.sliceString(from, to);
          const newDecoration = rawLinkDecoration(text);
          widgets.push(newDecoration.range(from, to));
        } else if (type.name === "Blockquote") {
          const newDecoration = blockquoteDecoration();
          widgets.push(newDecoration.range(from));
        } else if (type.name === "Table") {
          const newDecoration = tableDecoration();
          widgets.push(newDecoration.range(from, to));
        } else if (type.name === "ListItem") {
          const text = state.doc.sliceString(from, to);
          const listType = ["-", "*"].includes(text[0]) ? "ul" : "ol";
          const index = text.split(" ")[0];
          const newDecoration = listItemDecoration(listType, index);
          widgets.push(newDecoration.range(from));
        } else if (type.name === "CodeText") {
          const newDecoration = codeBlockDecoration();
          const fromLine = state.doc.lineAt(from);
          const toLine = state.doc.lineAt(to);
          for (let i = fromLine.from; i < toLine.to; i++) {
            const linePosition = state.doc.lineAt(i);
            widgets.push(newDecoration.range(linePosition.from));
          }
          const newStartDecoration = codeBlockStartDecoration();
          const previousLineFrom = state.doc.lineAt(fromLine.from - 1).from;
          widgets.push(newStartDecoration.range(previousLineFrom));
          // widgets.push(newDecoration.range(from));
        } else if (["HTMLTag", "HTMLBlock"].includes(type.name)) {
          let text = state.doc.sliceString(from, to);
          const tag = /<(?<tag>[^/\s>]*)/.exec(text)?.groups?.tag;
          if (tag === "a") {
            const linkRegexHtml =
              /<a.*?href="(?<url>.*?)".*?>(?<linkText>[^]*?)[<\/a>]*/gm;
            let urlResult = linkRegexHtml.exec(text);
            if (urlResult && urlResult.groups && urlResult.groups.url) {
              if (!text.includes("</a>")) {
                // extend range to include closing tag
                const endTagRegexRes = /<\/a>/.exec(state.doc.sliceString(to));
                const endTagIndex = endTagRegexRes
                  ? endTagRegexRes.index + endTagRegexRes[0].length
                  : 0;

                to = to + endTagIndex;
                text = state.doc.sliceString(from, to);
              }
              const linkRegexHtml =
                /<a.*?href="(?<url>.*?)".*?>(?<linkText>[^]*?)<\/a>/gm;
              const newUrlResult = linkRegexHtml.exec(text);
              if (newUrlResult) urlResult = newUrlResult;
              let linkText = urlResult.groups.linkText;
              const url = urlResult.groups.url;
              if (url) {
                const includesHtml = /<.*?>/.exec(linkText);
                if (includesHtml) {
                  const newDecoration = htmlTagDecoration({ text, context });
                  widgets.push(newDecoration.range(from, from));
                  const newAltDecoration = htmlTagTextDecoration({ text });
                  widgets.push(newAltDecoration.range(from, to));
                } else {
                  const absoluteUrl = parseUrl(url, context);
                  const newAltDecoration = linkAltDecoration(
                    text,
                    linkText,
                    absoluteUrl
                  );
                  const altIndexStart = from + text.indexOf(linkText);
                  if (linkText)
                    widgets.push(
                      newAltDecoration.range(
                        altIndexStart,
                        altIndexStart + linkText.length
                      )
                    );
                  const newDecoration = linkDecoration(
                    text,
                    linkText,
                    absoluteUrl
                  );
                  widgets.push(newDecoration.range(from, to));
                }
              }
            } else if (text === "</a>") {
              const newAltDecoration = linkDecoration(text, "", "");
              widgets.push(newAltDecoration.range(from, to));
            }
          } else if (
            [
              "i",
              "b",
              "u",
              "details",
              "summary",
              "video",
              "img",
              "h1",
              "h2",
              "h3",
              "h4",
              "h5",
              "h6",
              "p",
              "table",
              "center",
              "pre",
              "div",
              "span",
              "code",
              "ul",
              "ol",
              "li",
              "iframe",
              "svg",
            ].includes(tag)
          ) {
            const endOfTagRegex = new RegExp(`(</${tag}\s*>)|(\s*/>)`);
            let endOfTag = endOfTagRegex.exec(text);
            const tagsWithNoEndNeeded = ["br", "img"];
            if (!endOfTag) {
              const subsequentText = state.doc.sliceString(to, to + 5000);
              const matches = endOfTagRegex.exec(subsequentText);
              const matchIndex = subsequentText.indexOf(matches?.[0]);
              if (matchIndex !== -1) {
                to = to + matchIndex + matches?.[0].length;
                text = state.doc.sliceString(from, to);
              } else if (!tagsWithNoEndNeeded.includes(tag)) {
                console.log("no end tag found for", tag);
                return;
              }
            }
            const newDecoration = htmlTagDecoration({ text, context });
            widgets.push(newDecoration.range(from, from));
            const newAltDecoration = htmlTagTextDecoration({ text });
            widgets.push(newAltDecoration.range(from, to));
          }
        } else if (type.name === "HorizontalRule") {
          const newDecoration = horizontalRuleDecorationAfter();
          widgets.push(newDecoration.range(from, to));
        }
      },
    });

    if (!widgets.length) return Decoration.none;

    // we need to return the widgets in order
    const sortedWidgets = widgets.sort((a, b) => {
      if (a.from < b.from) return -1;
      if (a.from > b.from) return 1;
      return a.value.startSide < b.value.startSide ? -1 : 1;
    });
    return RangeSet.of(sortedWidgets);
  };

  const copysTheme = EditorView.baseTheme({});

  const copysField = StateField.define<DecorationSet>({
    create(state) {
      return decorate(state);
    },
    update(copys, transaction) {
      // if (transaction.docChanged || transaction.changes.length > 0) {
      return decorate(transaction.state);
      // }

      // return copys.map(transaction.changes);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

  return [copysTheme, copysField];
};

export const markdownKeymap: KeyBinding[] = [
  // text formatting
  {
    key: "Mod-b",
    run: (view) => toggleWrapSelectionWithSymbols(view, "**"),
  },
  {
    key: "Mod-i",
    run: (view) => toggleWrapSelectionWithSymbols(view, "_"),
  },
  {
    key: "`",
    run: (view) => toggleWrapSelectionWithSymbols(view, "`", false),
  },
  {
    key: "_",
    run: (view) => toggleWrapSelectionWithSymbols(view, "_", false),
  },
  {
    key: "~",
    run: (view) => toggleWrapSelectionWithSymbols(view, "~", false),
  },
  {
    key: "^",
    run: (view) => toggleWrapSelectionWithSymbols(view, "^", false),
  },
];

const toggleWrapSelectionWithSymbols = (
  view: EditorView,
  symbols: string,
  doTriggerOnEmptySelection = true
) => {
  const selection = view.state.selection;
  let runningDiff = 0; // to keep track of previous changes with multiple selections
  let numberOfChanges = 0;

  selection.ranges.forEach((range, i) => {
    let from = range.from + runningDiff;
    let to = range.to + runningDiff;
    let text = view.state.doc.sliceString(from, to);

    if (!text) {
      if (!doTriggerOnEmptySelection) {
        const newRange = EditorSelection.range(from, to);
        let newState = view.state.update({
          selection: view.state.selection.replaceRange(newRange, i),
        });
        view.dispatch(newState);
        return;
      }
      // select word at cursor
      const edgeOfWordLeft = moveBySubword(view, range, false).from;
      const edgeOfWordRight = moveBySubword(view, range, true).from;
      const word = view.state.doc.sliceString(edgeOfWordLeft, edgeOfWordRight);
      if (word) {
        from = edgeOfWordLeft;
        to = edgeOfWordRight;
        text = word;
      }
    }

    let isWrappedBySymbols = text.startsWith(symbols) && text.endsWith(symbols);

    if (!isWrappedBySymbols) {
      // check if the symbols are just outside the selection
      const surroundingText = view.state.doc.sliceString(
        from - symbols.length,
        to + symbols.length
      );
      const isSurroundedBySymbols =
        surroundingText.startsWith(symbols) &&
        surroundingText.endsWith(symbols);
      if (isSurroundedBySymbols) {
        from -= symbols.length;
        to += symbols.length;
        text = view.state.doc.sliceString(from, to);
        isWrappedBySymbols = true;
      }
    }

    const newText = isWrappedBySymbols
      ? text.slice(symbols.length, -symbols.length)
      : symbols + text + symbols;
    const textDiff = newText.length - text.length;
    runningDiff += textDiff;

    // change the active selection to just inside the symbols (or removed symbols)
    const newFrom = textDiff > 0 ? from + textDiff / 2 : from;
    const newTo = textDiff > 0 ? to + textDiff / 2 : to + textDiff;

    // update the state
    const newRange = EditorSelection.range(newFrom, newTo);
    let newState = view.state.update({
      changes: { from, to, insert: newText },
      selection: view.state.selection.replaceRange(newRange, i),
    });
    view.dispatch(newState);
    numberOfChanges++;
  });

  return numberOfChanges > 0; // return true to always use this behavior
};

// nabbed from @codemirror/commands/dist/index.js
function moveBySubword(view, range, forward) {
  let categorize = view.state.charCategorizer(range.from);
  return view.moveByChar(range, forward, (start) => {
    let cat = CharCategory.Space,
      pos = range.from;
    let done = false,
      sawUpper = false,
      sawLower = false;
    let step = (next) => {
      if (done) return false;
      pos += forward ? next.length : -next.length;
      let nextCat = categorize(next),
        ahead;
      if (cat == CharCategory.Space) cat = nextCat;
      if (cat != nextCat) return false;
      if (cat == CharCategory.Word) {
        if (next.toLowerCase() == next) {
          if (!forward && sawUpper) return false;
          sawLower = true;
        } else if (sawLower) {
          if (forward) return false;
          done = true;
        } else {
          if (
            sawUpper &&
            forward &&
            categorize((ahead = view.state.sliceDoc(pos, pos + 1))) ==
              CharCategory.Word &&
            ahead.toLowerCase() == ahead
          )
            return false;
          sawUpper = true;
        }
      }
      return true;
    };
    step(start);
    return step;
  });
}

export const slugifyId = (str: string) => {
  return (
    str
      .toLowerCase()
      // replace spaces with dashes
      .replace(/\s+/g, "-")
      // remove non alphanumeric characters
      .replace(/[^a-z0-9-]/g, "")
      // remove leading and trailing dashes
      .replace(/^-+|-+$/g, "")
  );
};
const slugifyHeading = (str: string) =>
  slugifyId(
    str
      // remove leading # & space
      .replace(/^#+\s*/, "")
      // handle links
      .replace(/\[([^\]]+)\]\(([^\)]+)\)/g, (match, text, url) => text)
      .trim()
  );

export const parseImageUrl = (
  url: string,
  context: FileContext | FolderContext
) => {
  if (!url.startsWith("http")) {
    const pathRoot = context.path.split("/").slice(0, -1).join("/");
    return `https://raw.githubusercontent.com/${context.owner}/${context.repo}/${context.sha}/${pathRoot}/${url}`;
  } else {
    return url;
  }
};
