/* @ds-bundle: {"format":4,"namespace":"Keystone","components":[{"name":"Icon"},{"name":"Button"},{"name":"IconButton"},{"name":"FilterChip"},{"name":"SearchField"},{"name":"StatusPill"},{"name":"Breadcrumb"},{"name":"NavRail"},{"name":"SubNav"},{"name":"DataTable"},{"name":"Pagination"},{"name":"StatCard"},{"name":"UserChip"}]} */
(function () {
  var R = window.React;
  var h = R.createElement;
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(" "); }

  // 24x24 line icons, 1.75 stroke, round caps. Generic shapes drawn for Keystone.
  var P = {
    home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
    file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6",
    map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
    scale: "M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z",
    gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
    cube: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
    sliders: "M6 3v6M6 13v8M12 3v10M12 17v4M18 3v4M18 11v10M4 11h4M10 15h4M16 9h4",
    bank: "M3 21h18M4 10h16M12 3l9 5H3zM6 10v8M10 10v8M14 10v8M18 10v8",
    users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
    logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
    bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
    search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
    filter: "M3 6h18M7 12h10M10 18h4",
    plus: "M12 5v14M5 12h14",
    x: "M18 6 6 18M6 6l12 12",
    eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    pencil: "M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z",
    download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
    trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6",
    chevron: "M9 18l6-6-6-6",
    pulse: "M22 12h-4l-3 9L9 3l-3 9H2",
    chart: "M3 3v18h18M7 16v-4M12 16V8M17 16v-7"
  };

  function Icon(props) {
    var d = P[props.name] || P.file;
    return h("svg", { className: cx("ks-icon", props.className), viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round", width: props.size || 20, height: props.size || 20, "aria-hidden": props.label ? undefined : "true", role: props.label ? "img" : undefined, "aria-label": props.label },
      h("path", { d: d }));
  }
  Icon.names = Object.keys(P);

  function Button(props) {
    var variant = props.variant || "primary";
    var rest = Object.assign({}, props); delete rest.variant; delete rest.icon; delete rest.size; delete rest.className; delete rest.children;
    return h("button", Object.assign({ type: "button" }, rest, { className: cx("ks-btn", "ks-btn-" + variant, props.size === "sm" && "ks-btn-sm", props.className) }),
      props.icon ? h(Icon, { name: props.icon }) : null, props.children);
  }

  function IconButton(props) {
    return h("button", { type: "button", className: cx("ks-iconbtn", props.tone === "danger" && "ks-iconbtn-danger", props.dot && "ks-bell", props.className), "aria-label": props.label, title: props.label, onClick: props.onClick },
      h(Icon, { name: props.icon }));
  }

  function FilterChip(props) {
    if (props.onRemove) {
      return h("span", { className: "ks-chip", role: "group", "aria-label": props.children },
        props.icon ? h(Icon, { name: props.icon }) : null, props.children,
        h("button", { type: "button", className: "ks-chip-x", "aria-label": "Remove filter " + props.children, onClick: props.onRemove }, h(Icon, { name: "x" })));
    }
    return h("button", { type: "button", className: "ks-chip", onClick: props.onClick },
      props.icon ? h(Icon, { name: props.icon }) : null, props.children);
  }

  function SearchField(props) {
    return h("label", { className: cx("ks-search", props.className), style: props.width ? { width: props.width } : undefined },
      h(Icon, { name: "search" }),
      h("input", { type: "search", placeholder: props.placeholder || "Search", "aria-label": props.label || props.placeholder || "Search", value: props.value, defaultValue: props.defaultValue, onChange: props.onChange }));
  }

  function StatusPill(props) {
    var tone = props.tone || "neutral";
    var tag = tone === "action" ? "button" : "span";
    return h(tag, { type: tag === "button" ? "button" : undefined, className: cx("ks-pill", "ks-pill-" + tone), onClick: props.onClick }, props.children);
  }

  function Breadcrumb(props) {
    var items = props.items || [];
    var out = [];
    if (props.icon !== false) out.push(h("span", { key: "i", className: "ks-home" }, h(Icon, { name: props.icon || "home" })));
    items.forEach(function (it, i) {
      if (i > 0 || props.icon !== false) out.push(h("span", { key: "s" + i, className: "ks-sep", "aria-hidden": "true" }, h(Icon, { name: "chevron", size: 16 })));
      var last = i === items.length - 1;
      out.push(last ? h("span", { key: i, "aria-current": "page" }, it.label) : h("a", { key: i, href: it.href || "#" }, it.label));
    });
    return h("nav", { className: "ks-crumbs", "aria-label": "Breadcrumb" }, out);
  }

  function NavRail(props) {
    var items = props.items || [];
    return h("aside", { className: "ks-rail" },
      h("div", { className: "ks-rail-logo", "aria-label": props.brand || "Keystone" }, props.monogram || "K"),
      h("nav", { "aria-label": "Modules" },
        items.map(function (it, i) {
          return h("a", { key: i, href: it.href || "#", "aria-current": it.id === props.current ? "page" : undefined }, h(Icon, { name: it.icon, size: 24 }), it.label);
        }),
        props.footer ? h("a", { className: "ks-rail-foot", href: props.footer.href || "#" }, h(Icon, { name: props.footer.icon || "logout", size: 20 }), props.footer.label) : null));
  }

  function SubNav(props) {
    var items = props.items || [];
    var plain = items.some(function (i) { return i.icon; });
    return h("nav", { className: cx("ks-subnav", plain && "ks-subnav-plain"), "aria-label": props.label || "Section" },
      props.brand ? h("div", { className: "ks-subnav-brand" }, props.brand[0] + " ", h("b", null, props.brand[1])) : null,
      items.map(function (it, i) {
        return h("a", { key: i, href: it.href || "#", "aria-current": it.id === props.current ? "page" : undefined },
          it.icon ? h(Icon, { name: it.icon }) : null, it.label, it.count != null ? h("span", { className: "ks-count" }, it.count) : null);
      }));
  }

  function DataTable(props) {
    var cols = props.columns || [];
    var rows = props.rows || [];
    return h("div", { className: "ks-table-card" },
      h("div", { className: "ks-table-scroll" },
        h("table", { className: "ks-table" },
          h("thead", null, h("tr", null, cols.map(function (c) { return h("th", { key: c.key, style: c.align ? { textAlign: c.align } : undefined }, c.label); }))),
          h("tbody", null, rows.map(function (r, ri) {
            return h("tr", { key: r.id || ri }, cols.map(function (c) {
              var v = c.render ? c.render(r, ri) : r[c.key];
              return h("td", { key: c.key, className: c.numeric ? "ks-num" : undefined, style: c.align ? { textAlign: c.align } : undefined }, v);
            }));
          })))),
      props.footer ? h("div", { className: "ks-table-foot" }, props.footer) : null);
  }

  function Pagination(props) {
    var page = props.page || 1, total = props.total || 1;
    var go = props.onChange || function () {};
    return h("div", { className: "ks-pager" },
      h("button", { type: "button", disabled: page <= 1, onClick: function () { go(page - 1); } }, props.prevLabel || "Previous"),
      h("span", { "aria-live": "polite" }, (props.pageLabel || "Page") + " " + page + " " + (props.ofLabel || "of") + " " + total),
      h("button", { type: "button", disabled: page >= total, onClick: function () { go(page + 1); } }, props.nextLabel || "Next"));
  }

  function StatCard(props) {
    var d = props.delta;
    return h("div", { className: cx("ks-stat", props.tone === "accent" && "ks-stat-accent") },
      h("div", { className: "ks-stat-label" }, props.label, props.icon ? h(Icon, { name: props.icon }) : null),
      h("div", { className: "ks-stat-value" }, props.value),
      d ? h("div", { className: cx("ks-stat-delta", d.direction === "down" ? "ks-down" : "ks-up") }, (d.direction === "down" ? "▼ " : "▲ ") + d.value, d.caption ? h("span", null, d.caption) : null) : null);
  }

  function UserChip(props) {
    var initials = (props.name || "?").split(" ").map(function (s) { return s[0]; }).slice(0, 2).join("");
    return h("div", { className: "ks-user" },
      props.avatar ? h("img", { className: "ks-avatar", src: props.avatar, alt: "" }) : h("span", { className: "ks-avatar", "aria-hidden": "true" }, initials),
      h("div", null, h("div", { className: "ks-user-name" }, props.name), props.email ? h("div", { className: "ks-user-mail" }, props.email) : null));
  }

  window.Keystone = Object.assign(window.Keystone || {}, {
    Icon: Icon, Button: Button, IconButton: IconButton, FilterChip: FilterChip, SearchField: SearchField,
    StatusPill: StatusPill, Breadcrumb: Breadcrumb, NavRail: NavRail, SubNav: SubNav, DataTable: DataTable,
    Pagination: Pagination, StatCard: StatCard, UserChip: UserChip
  });
})();
