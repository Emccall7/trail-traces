// ✅ Define the bounding box for the PCT region
const pctBounds = [
    [25, -140], // Southwest corner
    [55, -100]  // Northeast corner
];

// ✅ Initialize the map with set boundaries and zoom constraints
const map = L.map('map', {
    minZoom: 5,
    maxZoom: 16,
    maxBounds: pctBounds,  // Restrict panning
    maxBoundsViscosity: 0.8, // Adds resistance when nearing boundaries
    zoomControl: false
}).setView([41.5, -120], 6);

// ✅ Optional: Prevent "bouncing" when hitting the edges
map.options.worldCopyJump = false;
map.options.inertia = false;

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


// ✅ Define Amazon S3 Bucket Base URL
const S3_BASE_URL = "https://trail-traces-images.s3.us-east-2.amazonaws.com/";

// ✅ Google Sheets CSV URL
const sheetURL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQx9Mem_WIOPZzLB0kdWXEiHNH1PYJGFMr-vjGWEDOFUG4nDApkazyXjgzsplriSvT4UemacswhvDrD/pub?output=csv";

// ✅ Track active marker
let activeMarker = null;
const postcards = [];

// ✅ Function to ensure image URLs follow S3 naming convention
function getS3ImageURL(postcardID, type) {
    return `${S3_BASE_URL}${postcardID}_${type}.jpg`;  // "1001_F.jpg" or "1001_B.jpg"
}

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

// ✅ Generate Share Button with Correct Class
function generateShareButton(postcardID) {
    return `<button id="copy-link" class="share-btn">Share</button>`;
}

// ✅ Initialize Marker Cluster Group (Ensure Postcards Stay Above Everything Else)
const markers = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 40
});

// ✅ Fetch and Load Postcards
fetch(sheetURL)
    .then(response => response.text())
    .then(csvText => {
        const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

        parsed.data.forEach(row => {
            const lat = parseFloat(row["Latitude"]);
            const lon = parseFloat(row["Longitude"]);
            const postcardID = row["postcardID"]?.trim();

            if (isNaN(lat) || isNaN(lon)) {
                console.warn(`Skipping invalid postcard ${postcardID} due to missing coordinates.`);
                return;
            }

            const placePosted = row["PlacePosted"]?.trim() || "Unknown Location";
            const datePosted = row["DatePosted"]?.trim() || "Unknown Date";
            let imageFrontURL = getS3ImageURL(postcardID, "F");
            let imageBackURL = getS3ImageURL(postcardID, "B");
            const name = row["Name"]?.trim() || "Unknown";

            console.log(`Adding marker: ${postcardID} at (${lat}, ${lon})`);

            // ✅ Create Marker
            const marker = L.marker([lat, lon], {
                icon: L.divIcon({
                    html: `<div class="custom-marker" data-id="${postcardID}"></div>`,
                    className: 'custom-marker-container',
                    iconSize: [20, 20]
                })
            });

            // ✅ Store Postcard Data
            const postcardData = { postcardID, placePosted, datePosted, imageFrontURL, imageBackURL, name };
            postcards.push(postcardData);

            // ✅ Marker Click Function
            marker.on('click', function () {
                updateSidebar(postcardData);
                highlightMarker(postcardID);
            });

            markers.addLayer(marker);
        });

        map.addLayer(markers);

        // ✅ Ensure postcards are fully loaded before selecting a random one
        setTimeout(() => {
            selectPostcardFromURL();
        }, 500);
    })
    .catch(error => console.error("Error loading postcard data:", error));

// ✅ Function to select a postcard from the URL or load a random one
function selectPostcardFromURL() {
    const params = new URLSearchParams(window.location.search);
    const postcardID = params.get("id");

    if (postcardID) {
        // ✅ If a postcard is already selected in the URL, load it
        const selectedPostcard = postcards.find(p => p.postcardID === postcardID);
        if (selectedPostcard) {
            updateSidebar(selectedPostcard);
            highlightMarker(postcardID);
        }
    } else {
        // ✅ If no postcard is in the URL, select a random one
        selectRandomPostcard();
    }
}

// ✅ Function to randomly select a postcard and display it
function selectRandomPostcard() {
    if (postcards.length === 0) {
        console.warn("No postcards available to select.");
        return;
    }

    const randomPostcard = postcards[Math.floor(Math.random() * postcards.length)];
    updateSidebar(randomPostcard);
    highlightMarker(randomPostcard.postcardID);
    updateURL(randomPostcard.postcardID);
}


// ✅ Function to Highlight Active Marker
function highlightMarker(postcardID) {
    document.querySelectorAll('.custom-marker').forEach(marker => {
        marker.classList.remove('selected'); // ✅ Remove previous highlight
        if (marker.dataset.id === postcardID) {
            marker.classList.add('selected'); // ✅ Add highlight to active marker
        }
    });
}


const sidebarContent = document.getElementById('sidebar-content');
sidebarContent.innerHTML = `<p>Loading postcards...</p>`;

function updateSidebar(data) {
    if (!data) {
        // ✅ If no postcard is selected yet, show this message
        document.getElementById('sidebar-content').innerHTML = `<p>Click on a marker in the map to view a postcard.</p>`;
        return;
    }

    const sidebarContent = document.getElementById('sidebar-content');
    sidebarContent.innerHTML = `
        <div class="postcard-container">
            <img id="postcard-image" class="postcard-image" src="${data.imageFrontURL}" alt="Postcard Image">
            ${data.imageBackURL ? `<button id="flip-button" class="flip-btn">⇆</button>` : ""}
        </div>

        <p><strong>From:</strong> <span id="postcard-name">${data.name}</span></p>
        <p><strong>Location:</strong> <span id="postcard-location">${data.placePosted}</span></p>
        <p><strong>Date:</strong> <span id="postcard-date">${data.datePosted}</span></p>

        <div class="share-buttons">
            <button id="copy-link" class="share-btn">Share</button>
        </div>
    `;

    updateURL(data.postcardID);
    highlightMarker(data.postcardID);

    // ✅ Ensure Flip Button Works
    const flipButton = document.getElementById('flip-button');
    const postcardImage = document.getElementById('postcard-image');

    if (flipButton && postcardImage) {
        let showingFront = true;
        flipButton.style.display = "block";

        flipButton.addEventListener('click', function () {
            showingFront = !showingFront;
            postcardImage.src = showingFront ? data.imageFrontURL : data.imageBackURL;
        });
    }

    // ✅ Copy Link Functionality
    document.getElementById('copy-link').addEventListener('click', () => {
        navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?id=${data.postcardID}`)
            .then(() => alert("Link copied to clipboard!"))
            .catch(err => console.error("Error copying to clipboard:", err));
    });
}






// ✅ Toggle About Section
document.getElementById("toggle-about").addEventListener("click", function () {
    const aboutContent = document.getElementById("about-content");
    aboutContent.classList.toggle("visible");
    this.textContent = aboutContent.classList.contains("visible") 
        ? "About This Project ▲" 
        : "About This Project ▼";
});

// ✅ FOR SIDEBAR:

// ✅ Select elements
const sidebar = document.getElementById('sidebar');
const toggleButton = document.getElementById('toggle-sidebar');

// ✅ Detect if user is on mobile
function isMobile() {
    return window.innerWidth <= 768;
}

// ✅ Set initial state (closed)
let isExpanded = false;
toggleButton.innerHTML = isMobile() ? '▲' : '▶'; // `›` for right, `▲` for up "▼

// ✅ Function to toggle sidebar
function toggleSidebar() {
    isExpanded = !isExpanded;

    if (isExpanded) {
        sidebar.classList.add('expanded');
        toggleButton.innerHTML = isMobile() ? '▼' : '◀'; // `‹` for left, `▼` for down
    } else {
        sidebar.classList.remove('expanded');
        toggleButton.innerHTML = isMobile() ? '▲' : '▶'; // `›` for right, `▲` for up
    }
}

// ✅ Attach event listener to toggle button
toggleButton.addEventListener('click', toggleSidebar);

// ✅ Update caret when resizing
window.addEventListener('resize', () => {
    toggleButton.innerHTML = isExpanded ? (isMobile() ? '▼' : '◀') : (isMobile() ? '▲' : '▶');
});


