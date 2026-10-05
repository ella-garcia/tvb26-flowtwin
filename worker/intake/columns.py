"""Column synonyms (English + common Spanish ERP headers) and value parsers. Pure functions, no DB."""
import re
import unicodedata
from datetime import date, datetime


def norm(s) -> str:
    """Case/accent-insensitive key: 'Número de Parte' -> 'numero de parte'; punctuation becomes a space."""
    s = unicodedata.normalize("NFKD", str(s if s is not None else "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def slug(s) -> str:
    return norm(s).replace(" ", "-")


# field -> (required, synonyms). Synonyms are written in readable form and normalised with norm().
KINDS = {
    "tier1-suppliers": {
        "name": (True, ["supplier name", "supplier", "name", "company", "proveedor", "nombre proveedor", "nombre del proveedor",
                        "razon social", "nombre", "empresa"]),
        "city": (True, ["city", "ciudad", "municipio", "localidad", "plaza"]),
        "state": (False, ["state", "estado", "entidad", "entidad federativa"]),
        "email": (False, ["contact email", "email", "e mail", "correo", "correo electronico", "email contacto",
                          "correo de contacto", "mail"]),
        "code": (False, ["supplier code", "supplier id", "vendor code", "vendor id", "vendor number", "codigo proveedor",
                         "codigo de proveedor", "cod proveedor", "clave proveedor", "clave de proveedor", "no proveedor",
                         "numero de proveedor", "id proveedor", "codigo"]),
    },
    "tier1-parts": {
        "number": (True, ["part number", "part no", "part", "part code", "numero de parte", "no de parte", "no parte",
                          "n de parte", "numero parte", "material", "numero de material", "sku", "item", "codigo"]),
        "name": (True, ["name", "part name", "description", "descripcion", "descripcion de parte", "nombre", "nombre de parte",
                        "descripcion del material"]),
        "supplier": (True, ["supplier code", "supplier", "supplier id", "vendor", "vendor code", "proveedor", "codigo proveedor",
                            "codigo de proveedor", "clave proveedor", "clave de proveedor", "cod proveedor"]),
        "unit_cost_mxn": (True, ["unit cost mxn", "unit cost", "cost", "price", "costo unitario", "costo unitario mxn",
                                 "precio unitario", "precio", "costo", "costo mxn"]),
        "daily_usage": (True, ["daily usage", "usage per day", "daily demand", "consumo diario", "uso diario", "demanda diaria",
                               "consumo diario promedio", "consumo por dia", "consumo promedio diario"]),
        "single_source": (False, ["single source", "sole source", "fuente unica", "unica fuente", "fuente unica si no",
                                  "proveedor unico"]),
        "criticality": (False, ["criticality", "critical", "criticidad", "prioridad", "nivel de criticidad"]),
    },
    "tier1-stock": {
        "number": (True, ["part number", "part no", "part", "numero de parte", "no de parte", "no parte", "numero parte",
                          "material", "numero de material", "sku", "item", "codigo"]),
        "on_hand": (True, ["on hand units", "on hand", "stock", "inventory", "units on hand", "existencia", "existencias",
                           "inventario", "cantidad en existencia", "saldo", "inventario disponible", "cantidad en stock"]),
        "as_of": (False, ["as of date", "as of", "date", "stock date", "fecha", "fecha de corte", "fecha corte",
                          "fecha de inventario", "fecha de existencia"]),
    },
    "tier1-releases": {
        "number": (True, ["part number", "part no", "part", "numero de parte", "no de parte", "no parte", "numero parte",
                          "material", "numero de material", "sku", "item", "codigo"]),
        "week_start": (True, ["week start", "week", "week of", "semana", "inicio de semana", "fecha de semana", "fecha semana",
                              "fecha", "semana inicio"]),
        "quantity": (True, ["quantity", "qty", "units", "cantidad", "cantidad requerida", "requerimiento", "demanda",
                            "pronostico", "liberacion"]),
    },
    "tier1-receipts": {
        "po_number": (True, ["po number", "po", "po no", "purchase order", "orden de compra", "oc", "no oc", "no de oc",
                             "numero de orden", "pedido", "no de pedido", "numero de pedido", "orden compra"]),
        "supplier": (False, ["supplier code", "supplier", "supplier id", "vendor", "vendor code", "proveedor",
                             "codigo proveedor", "codigo de proveedor", "clave proveedor", "cod proveedor"]),
        "number": (True, ["part number", "part no", "part", "numero de parte", "no de parte", "no parte", "numero parte",
                          "material", "numero de material", "sku", "item", "codigo"]),
        "promised_date": (True, ["promised date", "promise date", "due date", "committed date", "fecha compromiso",
                                 "fecha promesa", "fecha prometida", "fecha de compromiso", "fecha entrega compromiso",
                                 "fecha de entrega compromiso", "fecha pactada"]),
        "received_date": (False, ["received date", "receipt date", "delivery date", "actual date", "fecha recepcion",
                                  "fecha de recepcion", "fecha real", "fecha de entrada", "fecha recibido", "fecha de entrega real",
                                  "fecha entrada"]),
        "quantity_ordered": (True, ["quantity ordered", "ordered qty", "qty ordered", "ordered", "cantidad pedida",
                                    "cantidad ordenada", "cantidad solicitada", "cantidad pedido", "pedido cantidad"]),
        "quantity_received": (False, ["quantity received", "received qty", "qty received", "received", "cantidad recibida",
                                      "cantidad entregada", "cantidad recepcion", "cantidad recibido"]),
    },
}
SYNONYMS = {k: {f: (req, {norm(s) for s in syn} | {norm(f)}) for f, (req, syn) in spec.items()} for k, spec in KINDS.items()}


def map_columns(kind: str, headers: list[str]):
    """-> (mapping {source header: field}, issues). First header that matches a field wins; extras are ignored (info)."""
    spec, mapping, taken, issues = SYNONYMS[kind], {}, set(), []
    for h in headers:
        key = norm(h)
        keys = {key, norm(re.sub(r"[(\[].*?[)\]]", "", str(h)))}  # 'single source (yes/no)' also matches 'single source'
        field = next((f for f, (_r, syn) in spec.items() if f not in taken and keys & syn), None)
        if field:
            mapping[h] = field
            taken.add(field)
        elif key:
            issues.append(dict(row=1, column=h, message="Column not recognised, ignored", severity="info"))
    for f, (req, _syn) in spec.items():
        if req and f not in taken:
            issues.append(dict(row=1, column=f, severity="error",
                               message=f"Required column missing: '{f}' (accepted headers include: {', '.join(sorted(spec[f][1])[:4])}...)"))
    return mapping, issues


# ---------------------------------------------------------------- value parsers (raise ValueError)
def is_blank(v) -> bool:
    return v is None or (isinstance(v, str) and not v.strip())


def parse_number(v) -> float:
    if isinstance(v, bool):
        raise ValueError("not a number")
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[\s$€]|mxn|usd|eur|pzas?|pcs|units?", "", str(v).strip(), flags=re.I)
    if not s:
        raise ValueError("empty")
    if "," in s and "." in s:
        s = s.replace(",", "") if s.rfind(".") > s.rfind(",") else s.replace(".", "").replace(",", ".")
    elif "," in s:
        parts = s.split(",")
        s = s.replace(",", ".") if len(parts) == 2 and len(parts[1]) != 3 else s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        raise ValueError(f"'{v}' is not a number") from None


def parse_date(v) -> date:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, (int, float)) and not isinstance(v, bool) and 20000 < v < 80000:  # Excel serial
        return date.fromordinal(date(1899, 12, 30).toordinal() + int(v))
    s = str(v).strip()
    m = re.fullmatch(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?", s)
    try:
        if m:
            return date(int(m[1]), int(m[2]), int(m[3]))
        m = re.fullmatch(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})", s)  # Mexican convention: day first
        if m:
            y = int(m[3]) + (2000 if len(m[3]) == 2 else 0)
            return date(y, int(m[2]), int(m[1]))
    except ValueError:
        pass
    raise ValueError(f"'{v}' is not a valid date (use YYYY-MM-DD or DD/MM/YYYY)")


def parse_bool(v) -> bool:
    if isinstance(v, bool):
        return v
    s = norm(v)
    if s in {"yes", "y", "si", "s", "true", "1", "x", "verdadero", "unico"}:
        return True
    if s in {"no", "n", "false", "0", "falso", ""}:
        return False
    raise ValueError(f"'{v}' is not yes/no")


def parse_criticality(v) -> str:
    s = norm(v)
    if s in {"line stopper", "linestopper", "line stop", "paro de linea", "paro linea", "critica", "critico", "critical"}:
        return "line-stopper"
    if s in {"high", "alta", "alto"}:
        return "high"
    if s in {"normal", "medium", "media", "medio", "low", "baja", "bajo", ""}:
        return "normal"
    raise ValueError(f"'{v}' is not line-stopper / high / normal")
