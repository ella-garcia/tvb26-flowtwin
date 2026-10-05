"""Small built-in gazetteer of Mexican industrial cities (lat, lon). Not exhaustive: unknown cities are reported, not guessed."""
from .columns import norm

# city -> (state, lat, lon)
CITIES = {
    "Querétaro": ("Querétaro", 20.59, -100.39), "San Juan del Río": ("Querétaro", 20.39, -99.99),
    "El Marqués": ("Querétaro", 20.55, -100.27), "Corregidora": ("Querétaro", 20.53, -100.44),
    "Celaya": ("Guanajuato", 20.52, -100.81), "León": ("Guanajuato", 21.12, -101.68), "Irapuato": ("Guanajuato", 20.68, -101.35),
    "Silao": ("Guanajuato", 20.94, -101.43), "Salamanca": ("Guanajuato", 20.57, -101.20), "Guanajuato": ("Guanajuato", 21.02, -101.26),
    "Aguascalientes": ("Aguascalientes", 21.88, -102.29),
    "San Luis Potosí": ("San Luis Potosí", 22.15, -100.98),
    "Puebla": ("Puebla", 19.04, -98.20), "San José Chiapa": ("Puebla", 19.31, -97.87),
    "Toluca": ("México", 19.29, -99.65), "Lerma": ("México", 19.28, -99.51), "Cuautitlán Izcalli": ("México", 19.65, -99.21),
    "Tlalnepantla": ("México", 19.54, -99.19), "Naucalpan": ("México", 19.48, -99.23), "Ecatepec": ("México", 19.60, -99.06),
    "Ciudad de México": ("Ciudad de México", 19.43, -99.13),
    "Pachuca": ("Hidalgo", 20.12, -98.73), "Tula": ("Hidalgo", 20.05, -99.34),
    "Tlaxcala": ("Tlaxcala", 19.32, -98.24), "Apizaco": ("Tlaxcala", 19.41, -98.14),
    "Cuernavaca": ("Morelos", 18.92, -99.23),
    "Orizaba": ("Veracruz", 18.85, -97.10), "Veracruz": ("Veracruz", 19.17, -96.13), "Córdoba": ("Veracruz", 18.88, -96.93),
    "Monterrey": ("Nuevo León", 25.67, -100.31), "Apodaca": ("Nuevo León", 25.78, -100.19),
    "Escobedo": ("Nuevo León", 25.80, -100.32), "Santa Catarina": ("Nuevo León", 25.67, -100.46),
    "Saltillo": ("Coahuila", 25.42, -101.00), "Ramos Arizpe": ("Coahuila", 25.54, -100.95), "Torreón": ("Coahuila", 25.54, -103.41),
    "Guadalajara": ("Jalisco", 20.67, -103.35), "Zapopan": ("Jalisco", 20.72, -103.39), "El Salto": ("Jalisco", 20.52, -103.18),
    "Manzanillo": ("Colima", 19.11, -104.34),
    "Morelia": ("Michoacán", 19.70, -101.19), "Lázaro Cárdenas": ("Michoacán", 17.96, -102.20),
    "Hermosillo": ("Sonora", 29.07, -110.96), "Chihuahua": ("Chihuahua", 28.64, -106.09),
    "Ciudad Juárez": ("Chihuahua", 31.69, -106.42), "Tijuana": ("Baja California", 32.51, -117.04),
    "Mexicali": ("Baja California", 32.66, -115.47), "Reynosa": ("Tamaulipas", 26.09, -98.28),
    "Matamoros": ("Tamaulipas", 25.87, -97.50), "Nuevo Laredo": ("Tamaulipas", 27.48, -99.52),
    "Durango": ("Durango", 24.02, -104.66), "Zacatecas": ("Zacatecas", 22.77, -102.57),
    "Mérida": ("Yucatán", 20.97, -89.62), "Oaxaca": ("Oaxaca", 17.07, -96.73),
}
_BY_KEY = {norm(c): (c, *v) for c, v in CITIES.items()}
_STATE_ALIAS = {"cdmx": "Ciudad de México", "df": "Ciudad de México", "edomex": "México", "edo mex": "México",
                "estado de mexico": "México", "qro": "Querétaro", "gto": "Guanajuato", "slp": "San Luis Potosí",
                "nl": "Nuevo León", "ver": "Veracruz", "jal": "Jalisco", "coah": "Coahuila", "pue": "Puebla",
                "ags": "Aguascalientes"}


def geocode(city, state=None):
    """-> (city, state, lat, lon) or None. A given state is kept (normalised through aliases), else taken from the table."""
    hit = _BY_KEY.get(norm(city))
    if not hit:
        return None
    name, tbl_state, lat, lon = hit
    st = None
    if state and str(state).strip():
        st = _STATE_ALIAS.get(norm(state), str(state).strip())
    return name, st or tbl_state, lat, lon
