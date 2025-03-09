// ✅ Initialize the map
const map = L.map('map', {
    minZoom: 5,
    maxZoom: 10
}).setView([41.5, -120], 6);

// ✅ Load CartoDB Positron (Base Layer with Labels)
const cartoBasemap = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 18
}).addTo(map);

// ✅ Load Full PCT Trail (Below Hillshade & Above Carto)
fetch('data/Full_PCT.geojson')
    .then(res => res.json())
    .then(pct => {
        const pctTrail = L.geoJSON(pct, {
            style: {
                color: '#008286',  // ✅ Blue shade for subtlety
                weight: 2,         // ✅ Lighter line weight
                opacity: 0.6       // ✅ Semi-transparent for better blending
            }
        }).addTo(map);

        // ✅ Ensure the trail stays **below** the hillshade
        cartoBasemap.bringToBack();
        pctTrail.bringToBack();
    })
    .catch(err => console.error("Error loading PCT trail:", err));

// ✅ Overlay Esri Hillshade (Topmost Layer for Terrain)
const hillshadeLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri, USGS, NASA',
    opacity: 0.5,  // ✅ Adjust transparency for balance
    maxZoom: 16
}).addTo(map);

// ✅ Initialize Marker Cluster Group (Ensure Postcards Stay **Above** Everything Else)
const markers = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 40
});

// ✅ Add markers on top of everything else
map.addLayer(markers);

// ✅ Google Sheets CSV URL
const sheetURL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQx9Mem_WIOPZzLB0kdWXEiHNH1PYJGFMr-vjGWEDOFUG4nDApkazyXjgzsplriSvT4UemacswhvDrD/pub?output=csv";

// ✅ Function to update the URL with the selected postcard ID
function updateURL(postcardID) {
    const newURL = `${window.location.origin}${window.location.pathname}?id=${postcardID}`;
    window.history.pushState({ path: newURL }, '', newURL);
}

// ✅ Function to get postcard ID from URL
function getPostcardIDFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get("id");
}

// ✅ Function to copy the current URL to clipboard
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        alert("Link copied to clipboard!");
    }).catch(err => console.error("Error copying to clipboard:", err));
}

// ✅ Function to generate only the "Copy Link" button
function generateShareLinks(postcardID) {
    const shareURL = encodeURIComponent(`${window.location.origin}${window.location.pathname}?id=${postcardID}`);
    
    return `
        <button id="copy-link" class="share-button">Share</button>
    `;
}

// ✅ Load Postcard Markers
fetch(sheetURL)
    .then(response => response.text())
    .then(csvText => {
        const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
        const postcards = [];

        parsed.data.forEach(row => {
            const lat = parseFloat(row["Latitude"]);
            const lon = parseFloat(row["Longitude"]);
            const postcardID = row["postcardID"]?.trim();  // ✅ Ensure ID is stored
            const placePosted = row["PlacePosted"]?.trim() || "Unknown Place";
            const datePosted = row["DatePosted"]?.trim() || "Unknown Date";
            let imageFrontURL = row["imageFrontURL"]?.trim();
            let imageBackURL = row["imageBackURL"]?.trim();
            const name = row["Name"]?.trim() || "Unknown";
            const contact = row["Contact"]?.trim() || "";

            function convertDriveURL(url) {
                if (url.includes("drive.google.com/thumbnail?id=")) {
                    return url.replace("thumbnail?id=", "uc?export=view&id=");
                }
                return url;
            }

            imageFrontURL = convertDriveURL(imageFrontURL);
            imageBackURL = convertDriveURL(imageBackURL);

            if (!isNaN(lat) && !isNaN(lon)) {
                const marker = L.marker([lat, lon], {
                    icon: L.divIcon({
                        html: `<div class="custom-marker"></div>`,
                        className: 'custom-marker-container',
                        iconSize: [20, 20]
                    })
                });

                const postcardData = { postcardID, placePosted, datePosted, imageFrontURL, imageBackURL, name, contact };
                postcards.push(postcardData);

                marker.on('click', function () {
                    updateSidebar(postcardData);
                });

                markers.addLayer(marker);
            }
        });

        map.addLayer(markers);
        selectPostcardFromURL(postcards); // ✅ Open postcard if ID exists in URL
    })
    .catch(error => console.error("Error loading postcard data:", error));

// ✅ Function to load and select a specific postcard based on URL
function selectPostcardFromURL(postcards) {
    const postcardID = getPostcardIDFromURL();
    if (!postcardID) return;

    const selectedPostcard = postcards.find(p => p.postcardID === postcardID);
    if (selectedPostcard) {
        updateSidebar(selectedPostcard);
    }
}

// ✅ Update Sidebar Content & Update URL
function updateSidebar(data) {
    const sidebarContent = document.getElementById('sidebar-content');
    sidebarContent.innerHTML = `
        <img id="postcard-image" src="${data.imageFrontURL}" class="postcard-image" alt="Postcard Image">

        <p><strong>From:</strong> ${data.name}</p>
        <p><strong>Location:</strong> ${data.placePosted}</p>
        <p><strong>Date:</strong> ${data.datePosted}</p>

        ${data.imageBackURL ? `<button id="flip-button">Flip to Back</button>` : ""}
        
        <div class="share-buttons">
            ${generateShareLinks(data.postcardID)}
        </div>
    `;

    // ✅ Update URL when a postcard is clicked
    updateURL(data.postcardID);

    // ✅ Flip Button Functionality
    if (data.imageBackURL) {
        const flipButton = document.getElementById('flip-button');
        const postcardImage = document.getElementById('postcard-image');
        let showingFront = true;

        flipButton.addEventListener('click', function () {
            if (showingFront) {
                postcardImage.src = data.imageBackURL;
                flipButton.textContent = "Flip to Front";
            } else {
                postcardImage.src = data.imageFrontURL;
                flipButton.textContent = "Flip to Back";
            }
            showingFront = !showingFront;
        });
    }

    // ✅ Copy Link Functionality
    document.getElementById('copy-link').addEventListener('click', () => {
        copyToClipboard(`${window.location.origin}${window.location.pathname}?id=${data.postcardID}`);
    });
}

// ✅ Initial sidebar content
document.getElementById('sidebar-content').innerHTML = `<p>Select a marker on the map to view details here.</p>`;
