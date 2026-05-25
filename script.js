// =========================================================
// Trail Traces — cleaned script.js
// =========================================================

// ---------------------------------------------------------
// Global state
// ---------------------------------------------------------

let selectedPostcardID = null;
let initialLoad = true;

let mini = null;
let searchIdSet = null; // null = no active search/filter
let searchRank = null;  // Map(postcardID -> rank)

let sortOrder = "date-desc";
let lastNonRelevanceSort = sortOrder;

let showBacks = false;
let showMature = false; // Always start hidden/off on page load

let isExpanded = false;

const postcards = [];
const postcardsById = new Map();
const markerById = new Map();

const allowSearchAnonNames = false;

const S3_BASE_URL = "https://trail-traces-images.s3.us-east-2.amazonaws.com/";
const sheetURL = "https://docs.google.com/spreadsheets/d/1-AHY6y5Sv9k02kV7dOcxbyZrt-d1dMBhlMlYCEA5gH4/export?format=csv&gid=0";

// ---------------------------------------------------------
// DOM elements
// ---------------------------------------------------------

const galleryButton = document.getElementById("toggle-gallery");
const mapView = document.getElementById("map");
const galleryView = document.getElementById("gallery-view");
const sidebar = document.getElementById("sidebar");
const toggleButton = document.getElementById("toggle-sidebar");
const sidebarContent = document.getElementById("sidebar-content");
const sortSelect = document.getElementById("sort-by");
const toolbar = document.getElementById("toolbar");
const toolbarToggle = document.getElementById("toolbar-toggle");

const sortWrap = document.getElementById("smart-sort");
const sortTrigger = document.getElementById("sort-trigger");
const sortMenu = document.getElementById("sort-menu");
const sortLabel = document.getElementById("sort-label");

const LABELS = {
    "date-desc": "Newest first",
    "date-asc": "Oldest first",
    "south-north-asc": "South → North",
    "south-north-desc": "North → South",
    "recent-desc": "Most recent ID",
    "recent-asc": "Oldest ID",
    "relevance": "Relevance"
};

let locationGroupLayer = null;
let locationGroups = [];
const GROUP_COORD_DECIMALS = 4; // roughly ~35 feet / 11 meters

// ---------------------------------------------------------
// Small helpers
// ---------------------------------------------------------

function trackEvent(name, params = {}) {
    if (typeof gtag === "function") {
        gtag("event", name, params);
    }
}

function labelFor(val) {
    return LABELS[val] || val;
}

function isMobile() {
    return window.innerWidth <= 768;
}

function getS3ImageURL(postcardID, type) {
    return `${S3_BASE_URL}${postcardID}_${type}.jpg`;
}

function getS3ImageUpperURL(postcardID, type) {
    return `${S3_BASE_URL}${postcardID}_${type}.JPG`;
}

function getS3ThumbURL(postcardID, type) {
    return `${S3_BASE_URL}thumbs/${postcardID}_${type}_thumb.jpg`;
}

function getS3ThumbUpperURL(postcardID, type) {
    return `${S3_BASE_URL}thumbs/${postcardID}_${type}_thumb.JPG`;
}

function setImageWithFallback(img, postcardID, type, useThumb = false) {
    const primary = useThumb
        ? getS3ThumbURL(postcardID, type)
        : getS3ImageURL(postcardID, type);

    const fallback = useThumb
        ? getS3ThumbUpperURL(postcardID, type)
        : getS3ImageUpperURL(postcardID, type);

    const finalFallback = getS3ImageURL(postcardID, type);

    img.src = primary;

    img.onerror = () => {
        img.onerror = () => {
            img.onerror = null;
            img.src = finalFallback;
        };
        img.src = fallback;
    };
}

function updateURL(postcardID) {
    if (!postcardID) return;
    const newURL = `${window.location.origin}${window.location.pathname}?id=${postcardID}`;
    window.history.pushState({ path: newURL }, "", newURL);
}

function getPostcardIDFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get("id");
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(() => alert("Link copied to clipboard!"))
        .catch(err => console.error("Error copying to clipboard:", err));
}

function stripTagQualifiers(str = "") {
    return String(str)
        .split("|")
        .map(s => s.split("@")[0])
        .map(s => s.trim())
        .filter(Boolean)
        .join(" ");
}

// ---------------------------------------------------------
// Leaflet map
// ---------------------------------------------------------

const map = L.map("map", {
    minZoom: 2,
    maxZoom: 16,
    zoomControl: false
}).setView([42, -120], 5);

map.createPane("mileMarkerPane");
map.getPane("mileMarkerPane").style.zIndex = 410;
map.getPane("mileMarkerPane").style.pointerEvents = "none";

map.createPane("postcardMarkerPane");
map.getPane("postcardMarkerPane").style.zIndex = 620;

map.createPane("postcardClusterPane");
map.getPane("postcardClusterPane").style.zIndex = 630;

map.options.worldCopyJump = false;
map.options.inertia = false;

const cartoBasemap = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.carto.com/">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 18
}).addTo(map);

fetch("data/Full_PCT.geojson")
    .then(res => res.json())
    .then(pct => {
        const pctTrail = L.geoJSON(pct, {
            style: {
                color: "#008286",
                weight: 2,
                opacity: 0.6
            }
        }).addTo(map);

        cartoBasemap.bringToBack();
        pctTrail.bringToBack();
    })
    .catch(err => console.error("Error loading PCT trail:", err));

const hillshadeLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}", {
    attribution: "&copy; Esri, USGS, NASA",
    opacity: 0.5,
    maxZoom: 16
}).addTo(map);


function getMarkerPostcardCount(marker) {
    if (marker?.locationGroup && Array.isArray(marker.locationGroup.postcards)) {
        return marker.locationGroup.postcards.length;
    }

    if (marker?.postcardID) return 1;

    return 1;
}

function getPostcardsFromMarker(marker) {
    if (marker?.locationGroup && Array.isArray(marker.locationGroup.postcards)) {
        return marker.locationGroup.postcards;
    }

    if (marker?.postcardID && postcardsById.has(marker.postcardID)) {
        return [postcardsById.get(marker.postcardID)];
    }

    return [];
}

function getPostcardsFromCluster(cluster) {
    const seen = new Set();
    const result = [];

    cluster.getAllChildMarkers().forEach(marker => {
        getPostcardsFromMarker(marker).forEach(postcard => {
            if (!postcard?.postcardID) return;
            if (seen.has(postcard.postcardID)) return;

            seen.add(postcard.postcardID);
            result.push(postcard);
        });
    });

    return result;
}

// Use a plain Leaflet layer group instead of MarkerCluster.
// MarkerCluster/Spiderfy was the source of the tiny “stranded” marker pile
// artifacts and the map lag. A few hundred postcards is light enough for
// normal Leaflet markers, and exact-coordinate duplicates are handled by
// the clean coordinate popup below.
let markers = L.markerClusterGroup({
    maxClusterRadius: function (zoom) {
        if (zoom >= 13) return 18;
        if (zoom >= 11) return 28;
        if (zoom >= 8) return 38;
        return 48;
    },

    spiderfyOnMaxZoom: false,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: false,
    chunkedLoading: true,
    removeOutsideVisibleBounds: true,
    animate: false,
    animateAddingMarkers: false,

    iconCreateFunction: function (cluster) {
        const clusterPostcards = getPostcardsFromCluster(cluster);
        const postcardCount = clusterPostcards.length;

        const containsSelected = clusterPostcards.some(
            p => String(p.postcardID) === String(selectedPostcardID)
        );

        let sizeClass = "small";
        if (postcardCount >= 50) sizeClass = "large";
        else if (postcardCount >= 10) sizeClass = "medium";

        return L.divIcon({
            html: `<div class="cluster-bubble ${sizeClass} ${containsSelected ? "selected-cluster" : ""}">${postcardCount}</div>`,
            className: "custom-cluster-icon",
            iconSize: L.point(44, 44),
            iconAnchor: [22, 22]
        });
    }
});

// Cluster click behavior
markers.on("clusterclick", function (e) {
    const cluster = e.layer;
    const clusterPostcards = getPostcardsFromCluster(cluster);

    if (!clusterPostcards.length) return;

    const currentZoom = map.getZoom();
    const maxZoom = map.getMaxZoom ? map.getMaxZoom() : 16;

    // If this cluster can still meaningfully separate, zoom first.
    if (currentZoom < 13 && currentZoom < maxZoom) {
        map.fitBounds(cluster.getBounds(), {
            padding: [42, 42],
            maxZoom: Math.min(13, maxZoom),
            animate: false
        });
        return;
    }

    // At closer zooms, show a list instead of spiderfying.
    openMarkerClusterPopup(cluster);
});

// Clean up old spiderfy artifacts from previous versions / cached DOM.
function clearSpiderArtifacts() {
    try {
        if (markers && typeof markers.unspiderfy === "function") {
            markers.unspiderfy();
        }
    } catch (err) {}

    document.querySelectorAll(
        ".leaflet-cluster-spider-leg, " +
        ".marker-cluster-spiderfy-child, " +
        ".spiderfy-child"
    ).forEach(el => el.remove());
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function postcardsAtSameCoordinate(postcard) {
    if (!postcard || !Number.isFinite(postcard.lat) || !Number.isFinite(postcard.lon)) return [];

    const key = getCoordinateKey(postcard);

    return getCurrentSortedList().filter(p =>
        p.hasCoords && getCoordinateKey(p) === key
    );
}

function getCoordinateKey(postcard, decimals = GROUP_COORD_DECIMALS) {
    if (!postcard || !Number.isFinite(postcard.lat) || !Number.isFinite(postcard.lon)) {
        return null;
    }

    return `${Number(postcard.lat).toFixed(decimals)},${Number(postcard.lon).toFixed(decimals)}`;
}

function buildLocationGroups() {
    const groups = new Map();

    getCurrentSortedList().forEach(postcard => {
        if (!postcard.hasCoords) return;

        const key = getCoordinateKey(postcard);
        if (!key) return;

        if (!groups.has(key)) {
            groups.set(key, {
                key,
                lat: Number(postcard.lat),
                lon: Number(postcard.lon),
                postcards: []
            });
        }

        groups.get(key).postcards.push(postcard);
    });

    locationGroups = Array.from(groups.values());
    return locationGroups;
}

function createLocationGroupIcon(group) {
    const count = group.postcards.length;

    const containsSelected = group.postcards.some(
        p => String(p.postcardID) === String(selectedPostcardID)
    );

    const className = [
        "custom-marker",
        "location-group-marker",
        count > 1 ? "is-cluster" : "is-single",
        containsSelected ? "selected" : ""
    ].join(" ");

    const html = count > 1
        ? `<span class="location-group-count">${count}</span>`
        : "";

    return L.divIcon({
        className,
        html,
        iconSize: count > 1 ? [46, 46] : [20, 20],
        iconAnchor: count > 1 ? [23, 23] : [10, 10]
    });
}

function refreshLocationGroupMarkerStyles() {
    if (!markers) return;

    markers.eachLayer(layer => {
        if (!layer.locationGroup) return;

        const group = layer.locationGroup;
        layer.setIcon(createLocationGroupIcon(group));
    });
}

function renderLocationGroupMarkers() {
    if (!markers) return;

    markers.clearLayers();
    markerById.clear();

    const groups = buildLocationGroups();

    groups.forEach(group => {
        const marker = L.marker([group.lat, group.lon], {
            pane: "postcardMarkerPane",
            icon: createLocationGroupIcon(group)
        });

        marker.locationGroup = group;

        group.postcards.forEach(postcard => {
            markerById.set(postcard.postcardID, marker);
        });

        marker.on("click", () => {
            if (group.postcards.length === 1) {
                selectPostcard(group.postcards[0], {
                    keepPanelState: true,
                    autoPan: false
                });

                highlightMarker(group.postcards[0].postcardID);
            } else {
                const selectedInGroup = group.postcards.find(
                    p => String(p.postcardID) === String(selectedPostcardID)
                );

                openCoordinateGroupPopup(group, selectedInGroup || null);
            }
        });

        markers.addLayer(marker);
    });
}


// MarkerCluster has been removed for smoother map performance.
// Exact-coordinate groups are opened by the Show on map button and by
// repeated-coordinate marker clicks where applicable.

// Delegate clicks inside the overlap popup list.
function openCoordinateGroupPopup(groupOrPostcard, selectedPostcard = null) {
    if (!map) return;

    let group;

    // Preferred: use the exact marker group.
    if (groupOrPostcard && Array.isArray(groupOrPostcard.postcards)) {
        group = groupOrPostcard;
    } else {
        // Fallback for older calls that pass one postcard.
        const postcard = groupOrPostcard;
        if (!postcard || !Number.isFinite(postcard.lat) || !Number.isFinite(postcard.lon)) return;

        const postcards = postcardsAtSameCoordinate(postcard);
        group = {
            lat: Number(postcard.lat),
            lon: Number(postcard.lon),
            postcards
        };

        selectedPostcard = selectedPostcard || postcard;
    }

    if (!group || !Array.isArray(group.postcards) || group.postcards.length <= 1) return;

    const selectedId =
        selectedPostcard &&
        group.postcards.some(p => String(p.postcardID) === String(selectedPostcard.postcardID))
            ? String(selectedPostcard.postcardID)
            : null;

    const rows = group.postcards.map(p => {
        const name = p.name || p.trailName || "Anonymous";
        const date = p.datePosted || "";
        const selected = p.postcardID === selectedId ? " selected" : "";

        return `
            <button class="coord-popup-card${selected}" type="button" data-id="${escapeHTML(p.postcardID)}">
                <span class="coord-popup-name">${escapeHTML(name)}</span>
                ${date ? `<span class="coord-popup-date">${escapeHTML(date)}</span>` : ""}
            </button>
        `;
    }).join("");

    L.popup({
        closeButton: true,
        autoPan: true,
        className: "coord-group-popup",
        maxWidth: 320
    })
        .setLatLng([group.lat, group.lon])
        .setContent(`
            <div class="coord-popup">
                <div class="coord-popup-title">${group.postcards.length} postcards here</div>
                <div class="coord-popup-list">${rows}</div>
            </div>
        `)
        .openOn(map);
}

function openMarkerClusterPopup(cluster) {
    if (!cluster || !map) return;

    const clusterPostcards = getPostcardsFromCluster(cluster);

    if (!clusterPostcards.length) return;

    const rows = clusterPostcards.slice(0, 60).map(p => {
        const name = p.anonymous === "Y"
            ? "Anonymous"
            : (p.name || p.trailName || p.from || "Anonymous");

        const date = p.datePosted || "";

        const selected =
            selectedId && String(p.postcardID) === selectedId
                ? " selected"
                : "";

        return `
            <button class="coord-popup-card${selected}" type="button" data-id="${escapeHTML(p.postcardID)}">
                <span class="coord-popup-name">${escapeHTML(name)}</span>
                ${date ? `<span class="coord-popup-date">${escapeHTML(date)}</span>` : ""}
            </button>
        `;
    }).join("");

    const more = clusterPostcards.length > 60
        ? `<div class="coord-popup-more">+ ${clusterPostcards.length - 60} more</div>`
        : "";

    L.popup({
        closeButton: true,
        autoPan: !isMobile(),
        closeOnClick: false,
        keepInView: false,
        className: "coord-group-popup",
        maxWidth: isMobile() ? 260 : 300,
        minWidth: isMobile() ? 220 : 260
    })
        .setLatLng(cluster.getLatLng())
        .setContent(`
            <div class="coord-popup">
                <div class="coord-popup-title">${clusterPostcards.length} postcards nearby</div>
                <div class="coord-popup-list">${rows}${more}</div>
            </div>
        `)
        .openOn(map);
}

document.addEventListener("click", (e) => {
    const btn = e.target.closest(".coord-popup-card");
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    const postcard = postcardsById.get(btn.dataset.id);
    if (!postcard) return;

    selectPostcard(postcard, {
        keepPanelState: true,
        autoPan: false
    });

    highlightMarker(postcard.postcardID);

    document.querySelectorAll(".coord-popup-card").forEach(el => {
        el.classList.toggle("selected", el.dataset.id === String(postcard.postcardID));
    });
}, true);

// ---------------------------------------------------------
// Sidebar rendering
// ---------------------------------------------------------

async function updateSidebar(data, { forceReveal = false } = {}) {
    postcardRotation = 0;

    if (!data) {
        sidebarContent.innerHTML = `<p>Select a marker or postcard to view details here.</p>`;
        return;
    }

    const currentSide = showBacks ? "B" : "F";
    const imgURL = showBacks
        ? (data.imageBackURL || getS3ImageURL(data.postcardID, "B"))
        : (data.imageFrontURL || getS3ImageURL(data.postcardID, "F"));

    if (data.isMature && !showMature && !forceReveal) {
        sidebarContent.innerHTML = `
            <div class="gate">
                <div class="gate-hero">
                    <img class="gate-image blurred" src="${imgURL}" alt="Mature postcard preview (blurred)">
                </div>
                <p>This postcard is marked as <strong>18+ Mature</strong>. It may contain profanity, sexual themes, explicit language, or other adult material.</p>
                <div class="gate-actions">
                    <button id="reveal-this" type="button">Continue to view</button>
                </div>

                <div class="next-card-container gate-nav" aria-label="Postcard navigation">
                    <button id="previous-card" class="next-card-btn" type="button">
                        <span class="arrow">←</span>
                        <span>Previous</span>
                    </button>

                    <button id="next-card" class="next-card-btn" type="button">
                        <span>Next</span>
                        <span class="arrow">→</span>
                    </button>
                </div>
            </div>
        `;

        const revealButton = document.getElementById("reveal-this");
        if (revealButton) {
            revealButton.addEventListener("click", () => {
                updateSidebar(data, { forceReveal: true });
                trackEvent("mature_reveal_sidebar_once", { event_category: "Filter" });
            });
        }

        const previousCardButton = document.getElementById("previous-card");
        if (previousCardButton) previousCardButton.addEventListener("click", viewPreviousCard);

        const nextCardButton = document.getElementById("next-card");
        if (nextCardButton) nextCardButton.addEventListener("click", viewNextCard);

        if (typeof updateSidebarToggleLabel === "function") {
            updateSidebarToggleLabel();
        }

        return;
    }

    const displayName = data.anonymous === "Y" ? "Anonymous" : data.name;

    sidebarContent.innerHTML = `
        <div class="postcard-container">
            <img id="postcard-image" class="postcard-image" alt="Postcard Image">
        </div>

        <div class="postcard-tool-container">
            <button id="flip-button" class="postcard-tool-btn flip-btn" type="button" aria-label="Flip postcard front or back">
                <span class="tool-icon">⇄</span>
                <span class="tool-label">Flip card</span>
            </button>

            <button id="rotate-button" class="postcard-tool-btn rotate-btn" type="button" aria-label="Rotate postcard image">
                <span class="tool-icon">⤾</span>
                <span class="tool-label">Rotate</span>
            </button>

            <button id="show-on-map" class="postcard-tool-btn show-on-map-btn" type="button" aria-label="Show postcard location on map">
                <span class="tool-icon">⌖</span>
                <span class="tool-label">Show on map</span>
            </button>
        </div>


        <div class="card-meta">
            <p><strong>From:</strong> <span id="postcard-name">${displayName}</span></p>
            <p><strong>Location:</strong> <span id="postcard-location">${data.placePosted || 'Not Available'}</span></p>
            <p><strong>Date:</strong> <span id="postcard-date">${data.datePosted || 'Not Available'}</span></p>
        </div>

        <div class="share-buttons">
            <button id="copy-link" class="share-btn">Share card</button>
        </div>

        <div class="next-card-container" aria-label="Postcard navigation">
            <button id="previous-card" class="next-card-btn" type="button">
                <span class="arrow">←</span>
                <span>Previous</span>
            </button>

            <button id="next-card" class="next-card-btn" type="button">
                <span>Next</span>
                <span class="arrow">→</span>
            </button>
        </div>
    `;

    const postcardImage = document.getElementById("postcard-image");

    if (postcardImage) {
        postcardImage.onload = () => {
            fitRotatedPostcard();
        };

        setImageWithFallback(postcardImage, data.postcardID, currentSide, false);
    }

    const rotateButton = document.getElementById("rotate-button");
    if (rotateButton) rotateButton.addEventListener("click", rotatePostcard);

    const flipButton = document.getElementById("flip-button");
    if (flipButton && postcardImage) {
        let currentlyShowingBack = showBacks;

        flipButton.addEventListener("click", () => {
            currentlyShowingBack = !currentlyShowingBack;

            postcardRotation = 0;

            postcardImage.onload = () => {
                fitRotatedPostcard();
            };

            setImageWithFallback(
                postcardImage,
                data.postcardID,
                currentlyShowingBack ? "B" : "F",
                false
            );
        });
    }

    const previousCardButton = document.getElementById("previous-card");
    if (previousCardButton) previousCardButton.addEventListener("click", viewPreviousCard);

    const nextCardButton = document.getElementById("next-card");
    if (nextCardButton) nextCardButton.addEventListener("click", viewNextCard);

    
    const showOnMapButton = document.getElementById("show-on-map");
    if (showOnMapButton) {
        showOnMapButton.addEventListener("click", () => {
            centerSelectedPostcardOnMap(data);
        });
    }


    const copyButton = document.getElementById("copy-link");
    if (copyButton) {
        copyButton.addEventListener("click", () => {
            const link = `${window.location.origin}${window.location.pathname}?id=${data.postcardID}`;
            navigator.clipboard.writeText(link)
                .then(() => {
                    alert("Link copied to clipboard!");
                    trackEvent("share_link", {
                        event_category: "Interaction",
                        event_label: "Copied Link"
                    });
                })
                .catch(err => console.error("Error copying link: ", err));
        });
    }

    updateURL(data.postcardID);

    // Keep the collapsed mobile peek thumbnail in sync with Show Fronts / Show Backs.
    // This matters when the postcard sheet is collapsed and the main sidebar content is hidden.
    if (typeof updateSidebarToggleLabel === "function") {
        updateSidebarToggleLabel();
    }
}

let postcardRotation = 0;

function fitRotatedPostcard() {
    const postcardImage = document.getElementById("postcard-image");
    const postcardContainer = document.querySelector(".postcard-container");

    if (!postcardImage || !postcardContainer) return;
    if (!postcardImage.naturalWidth || !postcardImage.naturalHeight) return;

    const containerW = postcardContainer.clientWidth;
    const containerH = postcardContainer.clientHeight;

    if (!containerW || !containerH) return;

    const imageW = postcardImage.naturalWidth;
    const imageH = postcardImage.naturalHeight;

    const rotation = ((postcardRotation % 360) + 360) % 360;
    const isSideways = rotation === 90 || rotation === 270;

    // When rotated sideways, the visual width/height swap.
    const visualW = isSideways ? imageH : imageW;
    const visualH = isSideways ? imageW : imageH;

    const fitScale = Math.min(
        containerW / visualW,
        containerH / visualH,
        1
    );

    const fittedW = Math.floor(imageW * fitScale);
    const fittedH = Math.floor(imageH * fitScale);

    postcardContainer.classList.toggle("postcard-vertical", isSideways);

    postcardImage.style.width = `${fittedW}px`;
    postcardImage.style.height = `${fittedH}px`;
    postcardImage.style.maxWidth = "none";
    postcardImage.style.maxHeight = "none";
    postcardImage.style.transform = `rotate(${rotation}deg)`;
}

function rotatePostcard() {
    postcardRotation = (postcardRotation + 90) % 360;
    fitRotatedPostcard();
}

window.addEventListener("resize", () => {
    fitRotatedPostcard();

    if (map) {
        map.invalidateSize({ animate: false });
    }
});

// ---------------------------------------------------------
// Data loading
// ---------------------------------------------------------

if (sidebarContent) sidebarContent.innerHTML = `<p>Loading postcards...</p>`;

fetch(sheetURL)
    .then(response => response.text())
    .then(csvText => {
        const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

        parsed.data.forEach(row => {
            const postcardID = row["postcardID"]?.trim();
            if (!postcardID) return;

            const rawLat = row["Latitude"];
            const rawLon = row["Longitude"];
            const lat = Number.isFinite(parseFloat(rawLat)) ? parseFloat(rawLat) : null;
            const lon = Number.isFinite(parseFloat(rawLon)) ? parseFloat(rawLon) : null;

            const placePosted = row["PlacePosted"]?.trim() || "Not Available";
            const datePosted = row["DatePosted"]?.trim() || "Unknown Date";
            const name = row["Name"]?.trim() || "Unknown";
            const anonymous = row["Anonymous"]?.trim() || "N";
            const isMature = (row["Mature"]?.trim()?.toUpperCase() === "Y");

            const rawName = row["Name"]?.trim() || "";
            const nameForIndex =
                (!allowSearchAnonNames && anonymous === "Y") ? "" :
                (rawName.toLowerCase() === "unknown" ? "" : rawName);

            const cleanTextF = (row["CleanText_F"] || "").trim();
            const cleanTextB = (row["CleanText_B"] || "").trim();
            const visualTagsF = stripTagQualifiers(row["VisualTags_F"] || "");
            const visualTagsB = stripTagQualifiers(row["VisualTags_B"] || "");

            const imageFrontURL = getS3ImageURL(postcardID, "F");
            const imageBackURL = getS3ImageURL(postcardID, "B");

            const postcardData = {
                postcardID,
                placePosted,
                datePosted,
                imageFrontURL,
                imageBackURL,
                name,
                anonymous,
                lat,
                lon,
                hasCoords: Number.isFinite(lat) && Number.isFinite(lon),
                isMature,
                cleanTextF,
                cleanTextB,
                visualTagsF,
                visualTagsB,
                nameIndex: nameForIndex
            };

            postcards.push(postcardData);
            postcardsById.set(postcardID, postcardData);
        });

        buildSearchIndex();
        sortPostcards();
        map.addLayer(markers);
        renderLocationGroupMarkers();
        selectPostcardFromURL(true);
    })
    .catch(error => {
        console.error("Error loading postcard data:", error);
        if (sidebarContent) sidebarContent.innerHTML = `<p>There was an error loading postcards.</p>`;
    });

// ---------------------------------------------------------
// Selection / navigation
// ---------------------------------------------------------

function selectPostcardFromURL(initialLoad = false) {
    const postcardID = getPostcardIDFromURL();

    if (postcardID) {
        const selectedPostcard = postcardsById.get(postcardID) || postcards.find(p => p.postcardID === postcardID);
        if (selectedPostcard) {
            selectPostcard(selectedPostcard, initialLoad);
        } else {
            console.warn("Postcard ID in URL not found. Selecting random postcard.");
            selectRandomPostcard(initialLoad);
        }
    } else {
        selectRandomPostcard(initialLoad);
    }
}

function selectRandomPostcard(initialLoad = false) {
    if (postcards.length === 0) {
        console.warn("No postcards available to select.");
        return;
    }

    const randomPostcard = postcards[Math.floor(Math.random() * postcards.length)];
    selectPostcard(randomPostcard, initialLoad);
}

function selectPostcard(postcard, options = {}) {
    if (!postcard) {
        console.warn("Invalid postcard selection.");
        return;
    }

    // Backward compatibility: selectPostcard(postcard, true)
    // still means initialLoad = true.
    const initialLoad = typeof options === "boolean" ? options : !!options.initialLoad;
    const autoPan = typeof options === "object" ? options.autoPan !== false : true;
    const keepPanelState = typeof options === "object" ? !!options.keepPanelState : false;

    selectedPostcardID = postcard.postcardID;

    updateSidebar(postcard);
    highlightMarker(postcard.postcardID);
    highlightSelectedCard();
    updateSidebarToggleLabel();

    // On mobile, selecting a marker/gallery thumbnail should only update the
    // quiet bottom peek. The user can expand the bottom sheet manually.
    if (isMobile() && !keepPanelState) {
        setSidebarExpanded(false);
    }

    if (autoPan) {
        panToMarker(postcard, initialLoad);
    }

    updateURL(postcard.postcardID);
}

function viewNextCard() {
    if (!selectedPostcardID) return;

    const sortedPostcards = getCurrentSortedList();
    const currentIndex = sortedPostcards.findIndex(p => p.postcardID === selectedPostcardID);

    if (currentIndex === -1 || sortedPostcards.length === 0) {
        console.warn("Selected postcard not found in sorted list.");
        return;
    }

    const nextIndex = (currentIndex + 1) % sortedPostcards.length;
    selectPostcard(sortedPostcards[nextIndex], { keepPanelState: true });
}

function viewPreviousCard() {
    if (!selectedPostcardID) return;

    const sortedPostcards = getCurrentSortedList();
    const currentIndex = sortedPostcards.findIndex(p => p.postcardID === selectedPostcardID);

    if (currentIndex === -1 || sortedPostcards.length === 0) {
        console.warn("Selected postcard not found in sorted list.");
        return;
    }

    const prevIndex = (currentIndex - 1 + sortedPostcards.length) % sortedPostcards.length;
    selectPostcard(sortedPostcards[prevIndex], { keepPanelState: true });
}

function highlightMarker(postcardID) {
    if (!postcardID) return;

    selectedPostcardID = postcardID;

    // 1. Highlight any individual visible custom marker
    document.querySelectorAll(".custom-marker").forEach(marker => {
        marker.classList.remove("selected");

        if (String(marker.dataset.id) === String(postcardID)) {
            marker.classList.add("selected");
        }
    });

    // 2. Rebuild grouped marker icons so any group containing the selected card
    // can turn selected too.
    if (typeof refreshLocationGroupMarkerStyles === "function") {
        refreshLocationGroupMarkerStyles();
    }

    // 3. Refresh MarkerCluster icons so larger clusters containing the selected card
    // can turn selected too.
    if (markers && typeof markers.refreshClusters === "function") {
        markers.refreshClusters();
    }
}

function highlightSelectedCard() {
    document.querySelectorAll(".gallery-card").forEach(card => {
        card.classList.toggle("selected", card.dataset.id === selectedPostcardID);
    });
}

function centerSelectedPostcardOnMap(postcard) {
    if (!postcard || !Number.isFinite(postcard.lat) || !Number.isFinite(postcard.lon)) {
        console.warn("Postcard has no coordinates; cannot center on map.", postcard);
        return;
    }

    // If gallery is open, switch back to map view first.
    if (galleryView && galleryView.style.display === "flex") {
        setViewMode("map");
    }

    // On phones, keep the postcard sheet quiet after the user asks to see the map.
    if (isMobile()) {
        setSidebarExpanded(false);
        if (toolbar && toolbar.classList.contains("expanded")) {
            setToolbarExpanded(false);
        }
    }

    const marker = markerById.get(postcard.postcardID);

    // If search/filter removed this marker, clear the search filter and restore markers.
    if (marker && !markers.hasLayer(marker)) {
        searchIdSet = null;
        searchRank = null;

        const searchInput = document.getElementById("search-input");
        if (searchInput) searchInput.value = "";

        if (typeof setRelevanceState === "function") {
            setRelevanceState(false);
        }

        applyMarkerFilter();
    }

    clearSpiderArtifacts();

    const targetLatLng = L.latLng(postcard.lat, postcard.lon);
    const targetZoom = Math.min(14, map.getMaxZoom ? map.getMaxZoom() : 14);

    setTimeout(() => {
        map.invalidateSize({ animate: false });

        // Use setView instead of flyTo. flyTo + markercluster animation was one
        // source of the lag/glitch loop.
        map.setView(targetLatLng, targetZoom, { animate: false });

        setTimeout(() => {
            highlightMarker(postcard.postcardID);
            openCoordinateGroupPopup(postcard);
        }, 80);
    }, 60);

    trackEvent("show_on_map", {
        event_category: "Interaction",
        event_label: postcard.postcardID
    });
}

function panToMarker(postcard) {
    if (!postcard || !Number.isFinite(postcard.lat) || !Number.isFinite(postcard.lon)) {
        highlightMarker(postcard?.postcardID);
        return;
    }

    clearSpiderArtifacts();

    const targetLatLng = L.latLng(postcard.lat, postcard.lon);

    if (!map.getBounds().contains(targetLatLng)) {
        map.setView(targetLatLng, Math.max(map.getZoom(), 10), { animate: false });
    }

    setTimeout(() => {
        highlightMarker(postcard.postcardID);
    }, 80);
}

// ---------------------------------------------------------
// Sidebar / bottom-sheet toggle
// ---------------------------------------------------------

function getMobilePeekText(postcard) {
    if (!postcard) return "View postcard";

    const clean = value => {
        if (!value) return "";
        const s = String(value).trim();
        if (!s || ["not available", "unknown", "unknown date", "n/a", "na"].includes(s.toLowerCase())) return "";
        return s;
    };

    const location = clean(postcard.placePosted);
    const date = clean(postcard.datePosted);

    if (location && date) return `${location} · ${date}`;
    if (location) return location;
    if (date) return date;
    return "View postcard";
}

function updateSidebarToggleLabel() {
    if (!toggleButton) return;

    const icon = toggleButton.querySelector(".toggle-icon");
    const peekText = toggleButton.querySelector(".toggle-peek-text");
    const peekThumb = document.getElementById("mobile-peek-thumb");
    const postcard = selectedPostcardID ? postcardsById.get(selectedPostcardID) : null;

    toggleButton.setAttribute("aria-expanded", String(isExpanded));

    if (isMobile()) {
        // Mobile behavior:
        // - collapsed: show handle + "View postcard" / selected card info
        // - expanded: show only the handle, no "Hide" text and no arrow
        if (icon) {
            icon.textContent = "";
            icon.setAttribute("aria-hidden", "true");
        }

        if (peekText) {
            peekText.textContent = isExpanded ? "" : getMobilePeekText(postcard);
        }

        const peekRow = toggleButton.querySelector(".toggle-peek-row");

        if (peekRow) {
            peekRow.classList.toggle("peek-hidden-expanded", isExpanded);
        }

        if (peekThumb) {
            if (postcard && !isExpanded) {
                peekThumb.style.display = "block";
                setImageWithFallback(peekThumb, postcard.postcardID, showBacks ? "B" : "F", true);
            } else {
                peekThumb.removeAttribute("src");
                peekThumb.style.display = "none";
            }
        }

        toggleButton.setAttribute(
            "aria-label",
            isExpanded ? "Postcard details" : "View postcard"
        );

        return;
    }

    // Desktop behavior stays the same
    if (icon) icon.textContent = isExpanded ? "◀" : "▶";
    if (peekText) peekText.textContent = "";
    if (peekThumb) peekThumb.style.display = "none";

    toggleButton.setAttribute(
        "aria-label",
        isExpanded ? "Collapse postcard panel" : "Expand postcard panel"
    );
}


function setSidebarExpanded(expanded) {
    isExpanded = !!expanded;

    // End any active drag state cleanly
    sheetDrag.active = false;
    sheetDrag.moved = false;

    sidebar.classList.remove("is-dragging");

    // CRITICAL: remove inline height from drag mode so CSS can control the sheet again
    sidebar.style.height = "";

    sidebar.classList.toggle("expanded", isExpanded);
    document.body.classList.toggle("sidebar-expanded", isExpanded);
    toggleButton?.setAttribute("aria-expanded", String(isExpanded));

    if (typeof updateSidebarToggleLabel === "function") {
        updateSidebarToggleLabel();
    }

    // Close map popup when opening the card sheet on mobile.
    // This prevents the Leaflet popup and bottom sheet from fighting for touch focus.
    if (isMobile() && isExpanded && map) {
        map.closePopup();
    }

    fitRotatedPostcard();

    // Only invalidate map size on desktop.
    // On mobile, invalidating while the bottom sheet opens/closes can make the map jump/glitch.
    if (!isMobile()) {
        window.setTimeout(() => {
            fitRotatedPostcard();

            if (map) {
                map.invalidateSize({ animate: false });
            }
        }, 280);
    }
}

// On mobile, tapping the map or gallery while the postcard sheet is expanded collapses it.
// This gives users a simple way back to browsing without needing a "Hide" button.
function initMobileTapToCollapseSidebar() {
    const mapEl = document.getElementById("map");
    const galleryEl = document.getElementById("gallery-view");

    function collapseIfMobileExpanded(e) {
        if (!isMobile()) return;
        if (!isExpanded) return;

        // Do not collapse from inside sidebar, toolbar, or popup interactions
        if (e.target.closest("#sidebar")) return;
        if (e.target.closest("#toolbar")) return;
        if (e.target.closest(".leaflet-popup")) return;

        setSidebarExpanded(false);
    }

    if (mapEl) {
        mapEl.addEventListener("click", collapseIfMobileExpanded);
    }

    if (galleryEl) {
        galleryEl.addEventListener("click", collapseIfMobileExpanded);
    }
}

initMobileTapToCollapseSidebar();

function initSidebarContentPullDown() {
    const sidebarContent = document.getElementById("sidebar-content");
    if (!sidebar || !sidebarContent) return;

    let startY = 0;
    let startScrollTop = 0;
    let pulling = false;

    sidebarContent.addEventListener("touchstart", (e) => {
        if (!isMobile() || !isExpanded) return;
        if (!e.touches || e.touches.length !== 1) return;

        startY = e.touches[0].clientY;
        startScrollTop = sidebarContent.scrollTop;
        pulling = false;
    }, { passive: true });

    sidebarContent.addEventListener("touchmove", (e) => {
        if (!isMobile() || !isExpanded) return;
        if (!e.touches || e.touches.length !== 1) return;

        const currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;

        // Only pull the sheet down when the content itself is already at the top
        if (startScrollTop <= 0 && sidebarContent.scrollTop <= 0 && deltaY > 14) {
            pulling = true;

            const minH = getCollapsedSheetHeight();
            const maxH = getExpandedSheetHeight();
            const nextH = Math.max(minH, Math.min(maxH, maxH - deltaY));

            sidebar.classList.add("is-dragging");
            sidebar.style.height = `${nextH}px`;

            if (e.cancelable) {
                e.preventDefault();
            }
        }
    }, { passive: false });

    sidebarContent.addEventListener("touchend", () => {
        if (!pulling) return;

        const currentH = sidebar.getBoundingClientRect().height;
        const minH = getCollapsedSheetHeight();
        const maxH = getExpandedSheetHeight();
        const midpoint = minH + (maxH - minH) * 0.72;

        sidebar.classList.remove("is-dragging");
        sidebar.style.height = "";

        setSidebarExpanded(currentH < midpoint ? false : true);

        pulling = false;
    }, { passive: true });

    sidebarContent.addEventListener("touchcancel", () => {
        pulling = false;
        sidebar.classList.remove("is-dragging");
        sidebar.style.height = "";
    }, { passive: true });
}

initSidebarContentPullDown();


let sheetDrag = {
    active: false,
    moved: false,
    startY: 0,
    startHeight: 0
};

function getCollapsedSheetHeight() {
    return 122;
}

function getExpandedSheetHeight() {
    return Math.min(window.innerHeight * 0.76, 680);
}

function enableMobileSheetDrag() {
    if (!toggleButton || !sidebar) return;

    toggleButton.addEventListener("click", (e) => {
        if (sheetDrag.moved) {
            e.preventDefault();
            sheetDrag.moved = false;
            return;
        }
        setSidebarExpanded(!isExpanded);
    });

    toggleButton.addEventListener("pointerdown", (e) => {
        if (!isMobile()) return;

        sheetDrag.active = true;
        sheetDrag.moved = false;
        sheetDrag.startY = e.clientY;
        sheetDrag.startHeight = sidebar.getBoundingClientRect().height;

        sidebar.classList.add("is-dragging");
        toggleButton.setPointerCapture?.(e.pointerId);
    });

    toggleButton.addEventListener("pointermove", (e) => {
        if (!sheetDrag.active || !isMobile()) return;

        const deltaY = sheetDrag.startY - e.clientY;
        if (Math.abs(deltaY) > 6) sheetDrag.moved = true;

        const minH = getCollapsedSheetHeight();
        const maxH = getExpandedSheetHeight();
        const nextH = Math.max(minH, Math.min(maxH, sheetDrag.startHeight + deltaY));

        sidebar.style.height = `${nextH}px`;
        sidebar.classList.toggle("expanded", nextH > minH + 30);
        document.body.classList.toggle("sidebar-expanded", nextH > minH + 30);
    });

    function finishDrag(e) {
        if (!sheetDrag.active) return;

        sheetDrag.active = false;
        sidebar.classList.remove("is-dragging");
        toggleButton.releasePointerCapture?.(e.pointerId);

        if (!isMobile()) {
            sidebar.style.height = "";
            return;
        }

        const currentH = sidebar.getBoundingClientRect().height;
        const minH = getCollapsedSheetHeight();
        const maxH = getExpandedSheetHeight();
        const midpoint = minH + (maxH - minH) * 0.38;

        const shouldExpand = currentH > midpoint;

        // Important: remove drag height so .expanded/.collapsed CSS can work again
        sidebar.style.height = "";

        setSidebarExpanded(shouldExpand);

        if (sheetDrag.moved) {
            setTimeout(() => {
                sheetDrag.moved = false;
            }, 0);
        }
    }

    toggleButton.addEventListener("pointerup", finishDrag);
    toggleButton.addEventListener("pointercancel", finishDrag);
}

if (toggleButton) {
    updateSidebarToggleLabel();
    enableMobileSheetDrag();
    document.body.classList.toggle("sidebar-expanded", isExpanded);

    window.addEventListener("resize", () => {
        if (sidebar) sidebar.style.height = "";
        updateSidebarToggleLabel();
    });
}

// ---------------------------------------------------------
// Mobile toolbar collapse / expand
// ---------------------------------------------------------

// ---------------------------------------------------------
// About section
// ---------------------------------------------------------

// ---------------------------------------------------------
// About section
// ---------------------------------------------------------

(function setupAboutToggle() {
    const oldButton = document.getElementById("toggle-about");
    const aboutContent = document.getElementById("about-content");
    const sidebar = document.getElementById("sidebar");

    if (!oldButton || !aboutContent) return;

    // Remove any older duplicated click listeners by cloning the button.
    const button = oldButton.cloneNode(true);
    oldButton.parentNode.replaceChild(button, oldButton);

    function setAboutOpen(open) {
        aboutContent.classList.toggle("visible", open);
        aboutContent.classList.toggle("hidden", !open);

        // Direct style backup so older CSS cannot override it.
        aboutContent.style.display = open ? "block" : "none";

        button.textContent = open
            ? "About This Project ▲"
            : "About This Project ▼";

        button.setAttribute("aria-expanded", String(open));
        aboutContent.setAttribute("aria-hidden", String(!open));

        if (open && sidebar) {
            requestAnimationFrame(() => {
                const sidebarRect = sidebar.getBoundingClientRect();
                const aboutRect = aboutContent.getBoundingClientRect();

                if (aboutRect.bottom > sidebarRect.bottom) {
                    sidebar.scrollTop += aboutRect.bottom - sidebarRect.bottom + 40;
                }
            });
        }
    }

    button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const isOpen = aboutContent.classList.contains("visible");
        setAboutOpen(!isOpen);
    });

    // Start closed.
    setAboutOpen(false);
})();

// ---------------------------------------------------------
// Sorting
// ---------------------------------------------------------

function getRelevanceOption() {
    if (!sortSelect) return null;
    return [...sortSelect.options].find(o => o.value === "relevance") || null;
}

function setSelectValueSafe(val) {
    if (!sortSelect) return;
    const ok = [...sortSelect.options].some(o => o.value === val);
    if (ok) sortSelect.value = val;
}

function setRelevanceState(active) {
    const opt = getRelevanceOption();

    if (opt) {
        opt.disabled = !active;
        opt.setAttribute("aria-disabled", String(!active));
        opt.title = active ? "Sort by search relevance" : "Start a search to enable";

        if (!active && sortSelect.value === "relevance") {
            setSelectValueSafe(lastNonRelevanceSort);
            sortOrder = lastNonRelevanceSort;
            sortPostcards();
            populateGallery();
        }
    }

    const li = document.querySelector('#sort-menu [data-value="relevance"]');
    if (li) {
        li.classList.toggle("disabled", !active);
        li.setAttribute("aria-disabled", String(!active));
        li.dataset.disabled = String(!active);
    }
}

function latAscValue(p) {
    return Number.isFinite(p.lat) ? p.lat : Number.POSITIVE_INFINITY;
}

function latDescValue(p) {
    return Number.isFinite(p.lat) ? p.lat : Number.NEGATIVE_INFINITY;
}

function compareByUserSort(a, b, sortType) {
    if (sortType === "date-asc") return new Date(a.datePosted) - new Date(b.datePosted);
    if (sortType === "date-desc") return new Date(b.datePosted) - new Date(a.datePosted);
    if (sortType === "south-north-asc") return latAscValue(a) - latAscValue(b);
    if (sortType === "south-north-desc") return latDescValue(b) - latDescValue(a);
    if (sortType === "recent-asc") return parseInt(a.postcardID) - parseInt(b.postcardID);
    if (sortType === "recent-desc") return parseInt(b.postcardID) - parseInt(a.postcardID);
    return 0;
}

function sortPostcards() {
    postcards.sort((a, b) => compareByUserSort(a, b, sortOrder));
}

function getCurrentSortedList() {
    const base = searchIdSet
        ? postcards.filter(p => searchIdSet.has(p.postcardID))
        : [...postcards];

    const sortType = document.getElementById("sort-by")?.value || sortOrder;

    return base.sort((a, b) => {
        if (sortType === "relevance" && searchRank) {
            const ra = searchRank.get(a.postcardID) ?? Number.POSITIVE_INFINITY;
            const rb = searchRank.get(b.postcardID) ?? Number.POSITIVE_INFINITY;
            return ra - rb;
        }

        const primary = compareByUserSort(a, b, sortType);
        if (primary !== 0) return primary;

        if (searchRank) {
            const ra = searchRank.get(a.postcardID) ?? Number.POSITIVE_INFINITY;
            const rb = searchRank.get(b.postcardID) ?? Number.POSITIVE_INFINITY;
            return ra - rb;
        }

        return 0;
    });
}

function restoreLastSort() {
    const safe = lastNonRelevanceSort || "date-desc";

    if (typeof selectSort === "function") {
        selectSort(safe, true);
        return;
    }

    setSelectValueSafe(safe);
    sortOrder = safe;

    const labelEl = document.getElementById("sort-label");
    if (labelEl) labelEl.textContent = labelFor(safe);

    sortPostcards();
    populateGallery();
}

if (sortSelect) {
    sortSelect.addEventListener("change", e => {
        const val = e.target.value;

        if (val === "relevance") {
            const rel = getRelevanceOption();
            if (!rel || rel.disabled) {
                setSelectValueSafe(lastNonRelevanceSort);
                return;
            }

            populateGallery();
            return;
        }

        sortOrder = val;
        lastNonRelevanceSort = val;
        sortPostcards();
        populateGallery();
    });
}

// ---------------------------------------------------------
// Smart sort dropdown
// ---------------------------------------------------------

function openSort() {
    if (!sortWrap || !sortTrigger || !sortMenu) return;
    sortWrap.classList.add("open");
    sortTrigger.setAttribute("aria-expanded", "true");
    setTimeout(() => sortMenu.focus(), 0);
}

function closeSort() {
    if (!sortWrap || !sortTrigger) return;
    sortWrap.classList.remove("open");
    sortTrigger.setAttribute("aria-expanded", "false");
}

function selectSort(value, apply = true) {
    if (!sortMenu) return;

    const li = sortMenu.querySelector(`[data-value="${value}"]`);
    if (!li) return;

    const isDisabled = li.dataset.disabled === "true";
    if (value === "relevance" && isDisabled) return;

    if (value !== "relevance") {
        sortOrder = value;
        lastNonRelevanceSort = value;
    }

    if (sortLabel) sortLabel.textContent = labelFor(value);
    if (sortSelect) sortSelect.value = value;

    if (apply) {
        if (value === "relevance") {
            populateGallery();
        } else {
            sortPostcards();
            populateGallery();
        }
    }

    closeSort();
}

if (sortTrigger && sortWrap && sortMenu) {
    sortTrigger.addEventListener("click", e => {
        e.stopPropagation();
        sortWrap.classList.contains("open") ? closeSort() : openSort();
    });

    document.addEventListener("click", e => {
        if (!sortWrap.contains(e.target)) closeSort();
    });

    document.addEventListener("keydown", e => {
        if (e.key === "Escape") closeSort();
    });

    sortMenu.addEventListener("click", e => {
        const li = e.target.closest('li[role="option"]');
        if (!li) return;

        const isDisabled =
            li.classList.contains("disabled") ||
            li.getAttribute("aria-disabled") === "true" ||
            li.dataset.disabled === "true";

        if (isDisabled) return;
        selectSort(li.dataset.value);
    });
}

if (sortSelect && sortLabel) {
    sortSelect.addEventListener("change", e => {
        sortLabel.textContent = labelFor(e.target.value);
    });
}

function sizeSmartSort() {
    const trigger = document.getElementById("sort-trigger");
    const menu = document.getElementById("sort-menu");

    if (!trigger || !menu) return;

    const prevDisplay = menu.style.display;
    const prevVis = menu.style.visibility;

    menu.style.visibility = "hidden";
    menu.style.display = "block";
    menu.style.width = "max-content";

    let max = 0;
    menu.querySelectorAll("li").forEach(li => {
        const w = li.getBoundingClientRect().width;
        if (w > max) max = w;
    });

    const final = Math.ceil(max + 30);

    trigger.style.width = `${final}px`;
    menu.style.minWidth = `${final}px`;

    menu.style.display = prevDisplay || "";
    menu.style.visibility = prevVis || "";
}

window.addEventListener("load", sizeSmartSort);
window.addEventListener("resize", sizeSmartSort);

// ---------------------------------------------------------
// Gallery
// ---------------------------------------------------------

function populateGallery() {
    if (!galleryView) return;

    galleryView.innerHTML = "";

    const baseList = searchIdSet
        ? postcards.filter(p => searchIdSet.has(p.postcardID))
        : postcards;

    const list = [...baseList];

    const relOpt = getRelevanceOption();
    const useRelevance = (
        sortSelect &&
        sortSelect.value === "relevance" &&
        relOpt &&
        !relOpt.disabled &&
        searchRank &&
        searchRank.size > 0
    );

    if (useRelevance) {
        list.sort((a, b) => {
            const ra = searchRank.has(a.postcardID) ? searchRank.get(a.postcardID) : Number.POSITIVE_INFINITY;
            const rb = searchRank.has(b.postcardID) ? searchRank.get(b.postcardID) : Number.POSITIVE_INFINITY;
            return ra - rb;
        });
    }

    if (list.length === 0) {
        galleryView.innerHTML = '<p style="margin-top:2rem;color:#666">No results. Try a different term.</p>';
        return;
    }

    list.forEach(postcard => {
        const card = document.createElement("div");
        card.className = "gallery-card";
        card.style.position = "relative";
        card.dataset.id = postcard.postcardID;

        const img = document.createElement("img");
        const side = showBacks ? "B" : "F";

        img.alt = `Postcard from ${postcard.placePosted || "Not Available"}`;
        img.loading = "lazy";
        setImageWithFallback(img, postcard.postcardID, side, true);

        if (postcard.isMature && !showMature) {
            card.classList.add("mature-blurred");

            const overlay = document.createElement("div");
            overlay.className = "mature-overlay";
            overlay.innerHTML = `
                <span aria-label="Mature content badge">18+ Mature</span>
                <button class="reveal-once" type="button">Reveal</button>
            `;

            overlay.querySelector(".reveal-once").addEventListener("click", e => {
                e.stopPropagation();
                card.classList.remove("mature-blurred");
                trackEvent("mature_reveal_once", { event_category: "Filter" });
            });

            card.appendChild(overlay);
        }

        card.addEventListener("click", () => {
            // Selecting a card from the gallery should update the sidebar,
            // but not move the map. Use the "Show on map" button for that.
            selectPostcard(postcard, { autoPan: false });
        });

        card.appendChild(img);
        galleryView.appendChild(card);
    });

    highlightSelectedCard();
}

// ---------------------------------------------------------
// Search
// ---------------------------------------------------------

function buildSearchIndex() {
    if (typeof MiniSearch !== "function") {
        console.error("[search] MiniSearch is not available. typeof=", typeof MiniSearch);
        return;
    }

    mini = new MiniSearch({
        fields: ["visualTagsF", "cleanTextF", "visualTagsB", "cleanTextB", "nameIndex"],
        storeFields: ["postcardID"],
        processTerm: term => (term || "")
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[^\w\s]/g, "")
            .trim() || null
    });

    const docs = postcards.map(p => ({
        id: p.postcardID,
        visualTagsF: p.visualTagsF || "",
        cleanTextF: p.cleanTextF || "",
        visualTagsB: p.visualTagsB || "",
        cleanTextB: p.cleanTextB || "",
        nameIndex: p.nameIndex || ""
    }));

    mini.addAll(docs);
}

const THESAURUS = {
    food: [
        "oatmeal", "granola", "bar", "snickers", "poptart", "ramen", "noodle", "pasta", "rice", "tortilla",
        "bread", "bagel", "pancake", "waffle", "pizza", "cheese", "salami", "tuna", "peanut", "butter",
        "pb", "jelly", "trailmix", "mix", "snack", "meal", "breakfast", "lunch", "dinner", "coffee", "tea", "cocoa"
    ],
    animal: [
        "dog", "cat", "bear", "deer", "elk", "moose", "coyote", "wolf", "fox", "bobcat", "cougar", "mountain", "lion",
        "squirrel", "chipmunk", "marmot", "goat", "horse", "cow", "sheep", "rattlesnake", "snake", "lizard", "frog",
        "bird", "eagle", "hawk", "owl", "raven", "crow", "duck", "goose", "bee", "wasp", "spider", "ant", "mosquito"
    ],
    weather: [
        "rain", "snow", "hail", "sleet", "wind", "storm", "thunder", "lightning", "sun", "sunny", "cloud", "fog",
        "heat", "cold", "freezing", "hot", "windy"
    ],
    plant: [
        "tree", "pine", "fir", "cedar", "oak", "maple", "spruce", "willow", "aspen", "flower", "wildflower", "bloom",
        "moss", "fern", "cactus", "grass", "bush", "shrub"
    ],
    gear: [
        "pack", "backpack", "tent", "stake", "pole", "poles", "sleeping", "bag", "pad", "stove", "fuel", "filter",
        "bottle", "bladder", "shoe", "shoes", "sock", "microspike", "spike", "gaiter", "jacket", "poncho", "headlamp"
    ]
};

const THESAURUS_ALIASES = {
    foods: "food",
    meals: "food",
    snacks: "food",
    snack: "food",
    breakfast: "food",
    lunch: "food",
    dinner: "food",
    animals: "animal",
    wildlife: "animal",
    critter: "animal",
    critters: "animal",
    plants: "plant",
    flowers: "plant",
    trees: "plant",
    tree: "plant",
    storms: "weather",
    sunny: "weather",
    cloudy: "weather"
};

function normalizeWord(s = "") {
    return String(s)
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function singularize(w = "") {
    const irr = {
        mice: "mouse",
        geese: "goose",
        children: "child",
        men: "man",
        women: "woman",
        teeth: "tooth",
        feet: "foot",
        people: "person"
    };

    if (irr[w]) return irr[w];
    if (w.endsWith("ies") && w.length > 3) return w.slice(0, -3) + "y";
    if (w.endsWith("es") && w.length > 2) return w.slice(0, -2);
    if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
    return w;
}

function wordVariants(w) {
    const v = new Set([w]);
    if (w.endsWith("y") && w.length > 3) v.add(w.slice(0, -1) + "ies");
    v.add(w + "s");
    v.add(w + "es");
    return [...v];
}

function expandTermSmart(raw) {
    const t = singularize(normalizeWord(raw));
    const canon = THESAURUS_ALIASES[t] || t;
    const baseList = THESAURUS[canon] || [t];

    const expanded = new Set();
    baseList.forEach(b => wordVariants(singularize(b)).forEach(x => expanded.add(x)));
    wordVariants(t).forEach(x => expanded.add(x));

    return [...expanded];
}

function normalizeForSearch(s = "") {
    return String(s)
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function docHasAnyOfTokens(p, tokens) {
    if (!p) return false;

    const fields = [
        normalizeForSearch(p.visualTagsF || ""),
        normalizeForSearch(p.cleanTextF || ""),
        normalizeForSearch(p.visualTagsB || ""),
        normalizeForSearch(p.cleanTextB || ""),
        normalizeForSearch(p.nameIndex || "")
    ];

    return tokens.some(tok => {
        const rx = new RegExp(`\\b${escapeRegExp(tok)}\\b`, "i");
        return fields.some(f => rx.test(f));
    });
}

function docHasAllGroups(p, groups) {
    return groups.every(groupTokens => docHasAnyOfTokens(p, groupTokens));
}

function runSearch(query) {
    if (!mini) {
        console.warn("[search] runSearch called before index built.");
        return;
    }

    const raw = (query || "").trim();

    if (typeof activeTheme !== "undefined" && activeTheme) {
        activeTheme = null;
        if (typeof highlightThemeChip === "function") highlightThemeChip();
    }

    if (raw === "") {
        searchIdSet = null;
        searchRank = null;
        setRelevanceState(false);
        restoreLastSort();
        applyMarkerFilter();
        return;
    }

    const baseTerms = raw
        .split(/\s+/)
        .map(t => t.toLowerCase().normalize("NFKD").replace(/[^\w\s]/g, "").trim())
        .filter(t => t.length >= 3);

    if (baseTerms.length === 0) {
        searchIdSet = null;
        searchRank = null;
        setRelevanceState(false);
        restoreLastSort();
        applyMarkerFilter();
        return;
    }

    const groups = baseTerms.map(t => expandTermSmart(t));
    const unionTokens = [...new Set(groups.flat())];

    const candidates = mini.search(unionTokens.join(" "), {
        prefix: false,
        fuzzy: 0,
        combineWith: "OR",
        fields: ["visualTagsF", "cleanTextF", "visualTagsB", "cleanTextB", "nameIndex"]
    });

    const filtered = candidates.filter(r => {
        const p = postcardsById.get(r.id) || postcards.find(x => x.postcardID === r.id);
        return docHasAllGroups(p, groups);
    });

    setRelevanceState(filtered.length > 0);

    searchIdSet = new Set(filtered.map(r => r.id));
    searchRank = new Map(filtered.map((r, i) => [r.id, i]));

    applyMarkerFilter();
    populateGallery();

    if (filtered.length === 0) {
        galleryView.innerHTML = '<p style="margin-top:2rem;color:#666">No results. Try a different term.</p>';
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const searchInput = document.getElementById("search-input");
    const searchClear = document.getElementById("search-clear");

    if (searchInput) {
        searchInput.addEventListener("keydown", e => {
            if (e.key === "Enter") {
                runSearch(searchInput.value);
            }

            if (e.key === "Escape") {
                searchInput.value = "";
                runSearch("");
            }
        });
    }

    if (searchClear) {
        searchClear.addEventListener("click", () => {
            if (searchInput) searchInput.value = "";
            runSearch("");
        });
    }

});

function applyMarkerFilter() {
    renderLocationGroupMarkers();

    console.log("[map] applyMarkerFilter → visible coordinate groups:", locationGroups.length);
}

// ---------------------------------------------------------
// Mile markers
// ---------------------------------------------------------

// ---------------------------------------------------------
// Mile markers — lightweight dynamic rendering
// ---------------------------------------------------------

let mileMarkerFeatures = [];
let mileMarkersLayer = L.layerGroup().addTo(map);

function getMileIntervalForZoom(zoom) {
    if (zoom >= 14) return 1;
    if (zoom >= 12) return 5;
    if (zoom >= 11) return 10;
    if (zoom >= 9) return 50;
    if (zoom >= 7) return 100;
    if (zoom >= 5) return 500;
    return null;
}

function shouldShowMile(mile, interval) {
    if (!interval) return false;

    const rounded = Math.round(mile);

    // Avoid floating point weirdness.
    return Math.abs(mile - rounded) < 0.001 && rounded % interval === 0;
}

function makeMileMarker(feature) {
    const coords = feature.geometry?.coordinates;
    if (!coords || coords.length < 2) return null;

    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    const mile = Number(feature.properties?.Mile);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(mile)) {
        return null;
    }

    const roundedMile = Math.round(mile);

    const icon = L.divIcon({
        className: "mile-marker-label",
        html: `
            <div class="mile-marker-inner">
                <span class="mile-marker-dot"></span>
                <span class="mile-marker-text">${roundedMile}</span>
            </div>
        `,
        iconSize: [52, 24],
        iconAnchor: [26, 12]
    });

    return L.marker([lat, lng], {
        pane: "mileMarkerPane",
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
            className: "mile-marker-label",
            html: `
                <div class="mile-marker-inner">
                    <span class="mile-marker-text">${roundedMile}</span>
                </div>
            `
        })
    });
}

function updateMileMarkers() {
    if (!mileMarkerFeatures.length || !mileMarkersLayer) return;

    const zoom = map.getZoom();
    const interval = getMileIntervalForZoom(zoom);

    mileMarkersLayer.clearLayers();

    if (!interval) return;

    const bounds = map.getBounds().pad(0.35);

    mileMarkerFeatures.forEach(feature => {
        const coords = feature.geometry?.coordinates;
        const mile = Number(feature.properties?.Mile);

        if (!coords || !Number.isFinite(mile)) return;

        const lng = Number(coords[0]);
        const lat = Number(coords[1]);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        if (!bounds.contains([lat, lng])) return;
        if (!shouldShowMile(mile, interval)) return;

        const marker = makeMileMarker(feature);
        if (marker) mileMarkersLayer.addLayer(marker);
    });
}

function addMileMarkers() {
    fetch("data/Full_PCT_Mile_Marker.geojson")
        .then(response => response.json())
        .then(data => {
            mileMarkerFeatures = data.features || [];

            updateMileMarkers();

            map.on("zoomend moveend", updateMileMarkers);
            map.on("zoomstart movestart", () => {
                if (mileMarkersLayer) mileMarkersLayer.clearLayers();
            });
        })
        .catch(error => console.error("Error loading mile markers:", error));
}

addMileMarkers();

// Mature controls are handled once in the main controls block below.

// ---------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------

document.addEventListener("keydown", e => {
    const active = document.activeElement;
    const isTyping =
        active &&
        (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable);

    if (isTyping) return;

    if (e.key === "ArrowRight") viewNextCard();
    if (e.key === "ArrowLeft") viewPreviousCard();
});


// ---------------------------------------------------------
// Main controls: map/gallery, fronts/backs, mature
// ---------------------------------------------------------

function getSelectedPostcard() {
    return selectedPostcardID ? postcardsById.get(selectedPostcardID) : null;
}

function getFrontsButton() {
    return (
        document.getElementById("show-fronts") ||
        document.getElementById("fronts-button")
    );
}

function getBacksButton() {
    return (
        document.getElementById("show-backs") ||
        document.getElementById("backs-button")
    );
}

function getMapButton() {
    return document.getElementById("view-map-btn");
}

function getGalleryButton() {
    return document.getElementById("view-gallery-btn");
}

function isGalleryOpen() {
    if (!galleryView) return false;
    return galleryView.style.display === "flex" || document.body.classList.contains("gallery-open");
}

function refreshSelectedPostcardViews() {
    const selected = getSelectedPostcard();

    if (selected) {
        updateSidebar(selected);
    }

    if (galleryView && isGalleryOpen()) {
        populateGallery();
        highlightSelectedCard();
    }

    if (typeof updateSidebarToggleLabel === "function") {
        updateSidebarToggleLabel();
    }
}

function syncModernControls() {
    const mapBtn = getMapButton();
    const galleryBtn = getGalleryButton();
    const legacyGalleryBtn = document.getElementById("toggle-gallery");

    const frontsBtn = getFrontsButton();
    const backsBtn = getBacksButton();

    const matureBtn = document.getElementById("mature-toggle");
    const galleryOpen = isGalleryOpen();

    if (mapBtn) {
        mapBtn.classList.toggle("active", !galleryOpen);
        mapBtn.setAttribute("aria-pressed", String(!galleryOpen));
    }

    if (galleryBtn) {
        galleryBtn.classList.toggle("active", galleryOpen);
        galleryBtn.setAttribute("aria-pressed", String(galleryOpen));
    }

    if (legacyGalleryBtn && !mapBtn && !galleryBtn) {
        legacyGalleryBtn.textContent = galleryOpen ? "View Map" : "View Gallery";
    }

    if (frontsBtn) {
        frontsBtn.classList.toggle("active", !showBacks);
        frontsBtn.setAttribute("aria-pressed", String(!showBacks));
    }

    if (backsBtn) {
        backsBtn.classList.toggle("active", showBacks);
        backsBtn.setAttribute("aria-pressed", String(showBacks));
    }

    if (matureBtn) {
        matureBtn.classList.toggle("active", !!showMature);
        matureBtn.classList.toggle("is-checked", !!showMature);
        matureBtn.setAttribute("aria-pressed", String(!!showMature));

        const mark = matureBtn.querySelector(".mature-checkmark");
        if (mark) mark.textContent = showMature ? "☑" : "☐";
    }
}

function setViewMode(mode) {
    const wantsGallery = mode === "gallery";
    if (!galleryView || !mapView) return;

    galleryView.style.display = wantsGallery ? "flex" : "none";
    mapView.style.display = wantsGallery ? "none" : "block";

    document.body.classList.toggle("gallery-open", wantsGallery);
    document.body.classList.toggle("gallery-view", wantsGallery);
    document.body.classList.toggle("map-open", !wantsGallery);
    document.body.classList.toggle("map-view", !wantsGallery);

    if (wantsGallery) {
        populateGallery();
        highlightSelectedCard();
    } else if (map) {
        window.setTimeout(() => {
            map.invalidateSize({ animate: false });
            if (selectedPostcardID) highlightMarker(selectedPostcardID);
        }, 30);
    }

    syncModernControls();
}

function setPostcardSide(wantsBacks) {
    showBacks = !!wantsBacks;

    const selected = getSelectedPostcard();

    if (selected) {
        updateSidebar(selected);
    }

    populateGallery();
    highlightSelectedCard();

    if (typeof updateSidebarToggleLabel === "function") {
        updateSidebarToggleLabel();
    }

    syncModernControls();

    trackEvent("toggle_postcard_side", {
        event_category: "Filter",
        event_label: showBacks ? "backs" : "fronts"
    });
}

function setMatureMode(enabled) {
    showMature = !!enabled;

    // Update gallery cards so mature cards blur/unblur there
    populateGallery();
    highlightSelectedCard();

    // Update the mobile/desktop sidebar toggle label/peek state
    if (typeof updateSidebarToggleLabel === "function") {
        updateSidebarToggleLabel();
    }

    // Update button states/checkmark/etc.
    syncModernControls();

    // IMPORTANT:
    // Do NOT call updateSidebar(selected) here.
    // That causes the open postcard image to visibly reload.

    trackEvent("mature_toggle", {
        event_category: "Filter",
        value: showMature ? 1 : 0
    });
}

// Use one delegated click handler for these controls.
// This avoids duplicate listeners and supports both current and older button IDs.
document.addEventListener("click", function (e) {
    const mapBtn = e.target.closest("#view-map-btn");
    const galleryBtn = e.target.closest("#view-gallery-btn");
    const frontsBtn = e.target.closest("#show-fronts, #fronts-button");
    const backsBtn = e.target.closest("#show-backs, #backs-button");
    const matureBtn = e.target.closest("#mature-toggle");

    if (!mapBtn && !galleryBtn && !frontsBtn && !backsBtn && !matureBtn) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (mapBtn) setViewMode("map");
    if (galleryBtn) setViewMode("gallery");
    if (frontsBtn) setPostcardSide(false);
    if (backsBtn) setPostcardSide(true);
    if (matureBtn) setMatureMode(!showMature);
}, true);

// Mature popover: hidden by default; visible only while hovering/focusing the control on devices that hover.
(function initCleanMaturePopover() {
    const btn = document.getElementById("mature-toggle");
    const pop = document.getElementById("mature-popover");
    if (!btn || !pop) return;

    pop.hidden = true;
    pop.classList.remove("visible", "open");

    function open() {
        if (window.matchMedia("(hover: none), (pointer: coarse)").matches) return;

        pop.hidden = false;
        pop.classList.add("visible");
        btn.classList.add("open");

        const r = btn.getBoundingClientRect();
        const popWidth = pop.offsetWidth || 280;

        pop.style.position = "fixed";
        pop.style.top = `${r.bottom + 8}px`;
        pop.style.left = `${Math.min(window.innerWidth - popWidth - 12, Math.max(12, r.left))}px`;
    }

    function close() {
        pop.hidden = true;
        pop.classList.remove("visible", "open");
        btn.classList.remove("open");
    }

    btn.addEventListener("mouseenter", open);
    btn.addEventListener("mouseleave", close);
    btn.addEventListener("focusin", open);
    btn.addEventListener("focusout", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
})();

// Initial control state.
showMature = false;
showBacks = false;
syncModernControls();

// Remove old cluster leftovers from cached sessions.
(function removeOldClusterArtifacts() {
    const selectors = ".leaflet-cluster-spider-leg, .marker-cluster-spiderfy-child, .spiderfy-child, .marker-cluster";
    document.querySelectorAll(selectors).forEach(el => el.remove());
    if (map) {
        map.on("zoomstart movestart", () => {
            document.querySelectorAll(selectors).forEach(el => el.remove());
        });
    }
})();

// ---------------------------------------------------------
// Mobile toolbar collapse / expand
// ---------------------------------------------------------

// ---------------------------------------------------------
// Mobile toolbar open / close
// ---------------------------------------------------------

let toolbarGesture = {
    active: false,
    moved: false,
    startY: 0,
    pointerId: null
};

function setToolbarExpanded(expanded) {
    if (!toolbar || !toolbarToggle) return;

    const open = !!expanded;

    toolbar.classList.toggle("expanded", open);
    toolbar.classList.toggle("collapsed", !open);
    document.body.classList.toggle("toolbar-expanded", open);

    toolbar.setAttribute("aria-expanded", String(open));
    toolbarToggle.setAttribute("aria-expanded", String(open));
}

function initMobileToolbarToggle() {
    if (!toolbar || !toolbarToggle) return;

    function startGesture(e) {
        if (!isMobile()) return;

        toolbarGesture.active = true;
        toolbarGesture.moved = false;
        toolbarGesture.startY = e.clientY;
        toolbarGesture.pointerId = e.pointerId;

        // Capture on the element that was actually touched, not always toolbarToggle.
        e.currentTarget.setPointerCapture?.(e.pointerId);
    }

    function moveGesture(e) {
        if (!toolbarGesture.active || !isMobile()) return;

        const deltaY = e.clientY - toolbarGesture.startY;

        if (Math.abs(deltaY) > 14) {
            toolbarGesture.moved = true;
        }
    }

    function finishGesture(e) {
        if (!toolbarGesture.active || !isMobile()) return;

        toolbarGesture.active = false;

        e.currentTarget.releasePointerCapture?.(e.pointerId);

        const deltaY = e.clientY - toolbarGesture.startY;
        const isOpen = toolbar.classList.contains("expanded");

        // Make closing less touchy than opening.
        // Drag down to open needs a smaller movement.
        // Drag up to close needs a more deliberate movement.
        const openThreshold = 24;
        const closeThreshold = 60;

        if (!isOpen && deltaY > openThreshold) {
            setToolbarExpanded(true);
        }

        if (isOpen && deltaY < -closeThreshold) {
            setToolbarExpanded(false);
        }

        setTimeout(() => {
            toolbarGesture.moved = false;
            toolbarGesture.pointerId = null;
        }, 0);
    }

    function handleToggleClick(e) {
        if (!isMobile()) return;

        e.preventDefault();
        e.stopPropagation();

        // If this click came after a drag, ignore it.
        if (toolbarGesture.moved) {
            toolbarGesture.moved = false;
            return;
        }

        setToolbarExpanded(!toolbar.classList.contains("expanded"));
    }

    function startExpandedToolbarGesture(e) {
        if (!isMobile()) return;
        if (!toolbar.classList.contains("expanded")) return;

        // Keep the actual search input normal.
        if (e.target.closest("#search-input")) return;

        // Keep open dropdown menu interactions normal.
        if (e.target.closest("#sort-menu")) return;

        // Keep mature popover interactions normal.
        if (e.target.closest("#mature-popover")) return;

        startGesture(e);
    }

    function handleExpandedToolbarClick(e) {
        if (!isMobile()) return;
        if (!toolbar.classList.contains("expanded")) return;

        // Do not close when using real controls.
        if (e.target.closest("#toolbar-toggle")) return;
        if (e.target.closest("#search-input")) return;
        if (e.target.closest("#search-clear")) return;
        if (e.target.closest("#sort-trigger")) return;
        if (e.target.closest("#sort-menu")) return;
        if (e.target.closest("#side-segmented-control")) return;
        if (e.target.closest("#mature-toggle")) return;
        if (e.target.closest("#mature-popover")) return;

        if (toolbarGesture.moved) {
            toolbarGesture.moved = false;
            return;
        }

        setToolbarExpanded(false);
    }

    // Main collapsed/expanded handle.
    toolbarToggle.addEventListener("pointerdown", startGesture);
    toolbarToggle.addEventListener("pointermove", moveGesture);
    toolbarToggle.addEventListener("pointerup", finishGesture);
    toolbarToggle.addEventListener("pointercancel", finishGesture);
    toolbarToggle.addEventListener("click", handleToggleClick);

    // Expanded toolbar can also be dragged upward from most of its area.
    toolbar.addEventListener("pointerdown", startExpandedToolbarGesture);
    toolbar.addEventListener("pointermove", moveGesture);
    toolbar.addEventListener("pointerup", finishGesture);
    toolbar.addEventListener("pointercancel", finishGesture);

    // Expanded toolbar can be tapped on empty/non-control space to close.
    toolbar.addEventListener("click", handleExpandedToolbarClick);

    window.addEventListener("resize", () => {
        toolbarGesture.active = false;
        toolbarGesture.moved = false;
        toolbarGesture.pointerId = null;

        if (isMobile()) {
            if (!toolbar.classList.contains("expanded")) {
                setToolbarExpanded(false);
            }
        } else {
            toolbar.classList.remove("expanded", "collapsed");
            toolbar.removeAttribute("aria-expanded");
            toolbarToggle.setAttribute("aria-expanded", "true");
            document.body.classList.remove("toolbar-expanded");
        }
    });

    if (isMobile()) {
        setToolbarExpanded(false);
    }
}

initMobileToolbarToggle();