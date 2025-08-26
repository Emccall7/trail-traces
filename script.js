// ✅ Global Variable to Track Selected Postcard and Initial Load
let selectedPostcardID = null;
let initialLoad = true; // ✅ Track if it's the first load

// ✅ Toggle between Map View and Gallery View
const galleryButton = document.getElementById('toggle-gallery');
const mapView = document.getElementById('map');
const galleryView = document.getElementById('gallery-view');


// ✅ Switch between views
galleryButton.addEventListener('click', function() {
    const isGalleryVisible = galleryView.style.display === 'flex';

    if (isGalleryVisible) {
        galleryView.style.display = 'none';
        mapView.style.display = 'block';
        galleryButton.textContent = 'View Gallery';
        gtag('event', 'toggle_view', {
            'event_category': 'Interaction',
            'event_label': 'Switched to Map'
        });
        if (selectedPostcardID) {
            console.log("Switching to Map View - Selected Postcard:", selectedPostcardID);
            highlightMarker(selectedPostcardID);
            const postcard = postcards.find(p => p.postcardID === selectedPostcardID);
            console.log("Postcard found for panning:", postcard);
            if (postcard) panToMarker(postcard);
        }
    } else {
        console.log("Switching to Gallery View");
        galleryView.style.display = 'flex';
        mapView.style.display = 'none';
        galleryButton.textContent = 'View Map';
        populateGallery();
        highlightSelectedCard(); // ✅ Highlight in Gallery
        gtag('event', 'toggle_view', {
            'event_category': 'Interaction',
            'event_label': 'Switched to Gallery'
        });
    }
});




// ✅ Function to Populate Gallery
function populateGallery() {
    galleryView.innerHTML = '';

    postcards.forEach(postcard => {
        const card = document.createElement('div');
        card.className = 'gallery-card';

        const img = document.createElement('img');
        img.src = showBacks ? getS3ImageURL(postcard.postcardID, 'B') : getS3ImageURL(postcard.postcardID, 'F');
        img.alt = `Postcard from ${postcard.placePosted}`;
        img.loading = 'lazy';

        // ✅ Click event to load sidebar with postcard
        card.addEventListener('click', function() {
            selectedPostcardID = postcard.postcardID; // ✅ Track selected postcard
            console.log("Selected Postcard in Gallery:", selectedPostcardID);
            updateSidebar(postcard);
            highlightMarker(postcard.postcardID); // ✅ Highlight on Map
            highlightSelectedCard(); // ✅ Highlight in Gallery
        });

        card.appendChild(img);
        galleryView.appendChild(card);
    });
}

// ✅ Function to Highlight the Selected Card in Gallery
function highlightSelectedCard() {
    document.querySelectorAll('.gallery-card').forEach(card => {
        card.classList.remove('selected');
    });

    const selectedCard = document.querySelector(`.gallery-card img[src*="${selectedPostcardID}_F.jpg"]`);
    if (selectedCard) {
        selectedCard.parentElement.classList.add('selected');
    }
}

// ✅ Updating the sidebar function to use async for the image
async function updateSidebar(data) {
    if (!data) {
        document.getElementById('sidebar-content').innerHTML = `<p>Select a marker or postcard to view details here.</p>`;
        return;
    }

    // ✅ Check if Anonymous field is marked as 'Y'
    const displayName = data.anonymous === 'Y' ? 'Anonymous' : data.name;
    console.log(`Sidebar - Postcard ${data.postcardID} Name: ${displayName} (Anonymous: ${data.anonymous})`);


    const sidebarContent = document.getElementById('sidebar-content');
    sidebarContent.innerHTML = `
        <div class="postcard-container">
            <img id="postcard-image" class="postcard-image" src="${showBacks ? await getS3ImageURL(data.postcardID, 'B') : await getS3ImageURL(data.postcardID, 'F')}" alt="Postcard Image">
            ${data.imageBackURL ? `<button id="flip-button" class="flip-btn">⇆</button>` : ""}
            <button id="rotate-button" class="rotate-btn">↻</button>
        </div>

        <p><strong>From:</strong> <span id="postcard-name">${displayName}</span></p>
        <p><strong>Location:</strong> <span id="postcard-location">${data.placePosted}</span></p>
        <p><strong>Date:</strong> <span id="postcard-date">${data.datePosted}</span></p>

        <div class="share-buttons">
            <button id="copy-link" class="share-btn">Share</button>
        </div>

        
    `;

    // ✅ Attach Flip and Rotate Button Functionality
        const rotateButton = document.getElementById("rotate-button");
        rotateButton.addEventListener("click", rotatePostcard);

    // ✅ Flip Button Logic
    const flipButton = document.getElementById('flip-button');
    const postcardImage = document.getElementById('postcard-image');

    if (flipButton && postcardImage && data.imageBackURL) {
        let showingFront = true;
        flipButton.style.display = "block";

        flipButton.addEventListener('click', function () {
            showingFront = !showingFront;
            postcardImage.src = showingFront ? data.imageFrontURL : data.imageBackURL;
        });
    }

    // ✅ Copy Link Functionality
    const copyButton = document.getElementById('copy-link');
    copyButton.addEventListener('click', () => {
        const link = `${window.location.origin}${window.location.pathname}?id=${data.postcardID}`;
        navigator.clipboard.writeText(link)
            .then(() => {
                alert("Link copied to clipboard!");
                // ✅ Google Analytics Event Tracking
                gtag('event', 'share_link', {
                    'event_category': 'Interaction',
                    'event_label': 'Copied Link'
                });
            })
            .catch(err => console.error("Error copying link: ", err));
    });

     // ✅ Update the URL when loading the sidebar
     updateURL(data.postcardID);
}






///////////////////////////////////////////



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
}).setView([42, -120], 5);

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
const sheetURL = "https://docs.google.com/spreadsheets/d/1-AHY6y5Sv9k02kV7dOcxbyZrt-d1dMBhlMlYCEA5gH4/export?format=csv&gid=0";


// ✅ Track active marker
let activeMarker = null;
const postcards = [];

// ✅ Function to ensure image URLs follow S3 naming convention (.jpg or .JPG)
function getS3ImageURL(postcardID, type) {
    const lowerCaseURL = `${S3_BASE_URL}${postcardID}_${type}.jpg`;
    const upperCaseURL = `${S3_BASE_URL}${postcardID}_${type}.JPG`;

    // ✅ Create an Image object to test loading
    const testImage = new Image();
    testImage.src = lowerCaseURL;

    // ✅ If it loads, return it; if not, fallback to .JPG
    testImage.onerror = () => {
        testImage.src = upperCaseURL;
    };

    return testImage.src;
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
            const anonymous = row["Anonymous"]?.trim() || "N"; // ✅ Read 'Anonymous' field

            console.log(`Loading Postcard ${postcardID} - Anonymous: ${anonymous}`);

            console.log(`Adding marker: ${postcardID} at (${lat}, ${lon})`);

            // ✅ Create Marker
            const marker = L.marker([lat, lon], {
                icon: L.divIcon({
                    html: `<div class="custom-marker" data-id="${postcardID}"></div>`,
                    className: 'custom-marker-container',
                    iconSize: [15, 15]
                })
            });

            // ✅ Store Postcard Data (including lat/lon)
            const postcardData = {
                postcardID,
                placePosted,
                datePosted,
                imageFrontURL,
                imageBackURL,
                name,
                anonymous, 
                lat, // ✅ Storing lat/lon directly in the postcard object
                lon
            };
            postcards.push(postcardData);

            // ✅ Marker Click Function
            marker.on('click', function () {
                updateSidebar(postcardData);
                highlightMarker(postcardID);
                selectedPostcardID = postcardID;
                console.log("Selected Postcard (Map Click):", selectedPostcardID);
            });

            markers.addLayer(marker);
            sortPostcards(); // ✅ Ensure postcards are sorted immediately
            
        });

        // ✅ Function to Sort Postcards (Used Immediately After Loading)
        function sortPostcards() {
            postcards.sort((a, b) => {
                if (sortOrder === "date-desc") {
                    return new Date(b.datePosted) - new Date(a.datePosted);
                } else if (sortOrder === "date-asc") {
                    return new Date(a.datePosted) - new Date(b.datePosted);
                } else if (sortOrder === "south-north-asc") {
                    return parseFloat(a.lat) - parseFloat(b.lat);
                } else if (sortOrder === "south-north-desc") {
                    return parseFloat(b.lat) - parseFloat(a.lat);
                } else if (sortOrder === "recent-asc") {
                    return parseInt(a.postcardID) - parseInt(b.postcardID);
                } else if (sortOrder === "recent-desc") {
                    return parseInt(b.postcardID) - parseInt(a.postcardID);
                }
                return 0; // Default no sort
            });
            console.log("Postcards Sorted:", sortOrder, postcards);
        }

        map.addLayer(markers);

        // ✅ Ensure postcards are fully loaded before selecting a random one
        setTimeout(() => {
            selectPostcardFromURL();
        }, 500);
    })
    .catch(error => console.error("Error loading postcard data:", error));

// ✅ Function to Select Postcard from URL with Initial Load Flag
function selectPostcardFromURL(initialLoad = false) {
    const params = new URLSearchParams(window.location.search);
    const postcardID = params.get("id");

    if (postcardID) {
        const selectedPostcard = postcards.find(p => p.postcardID === postcardID);
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

// ✅ Function to randomly select a postcard and display it
function selectRandomPostcard() {
    if (postcards.length === 0) {
        console.warn("No postcards available to select.");
        return;
    }

    const randomPostcard = postcards[Math.floor(Math.random() * postcards.length)];
    console.log("Randomly Selected Postcard:", randomPostcard);

    selectPostcard(randomPostcard);
}


// ✅ Function to Highlight Active Marker
function highlightMarker(postcardID) {
    console.log("Highlighting Marker for Postcard:", postcardID);
    document.querySelectorAll('.custom-marker').forEach(marker => {
        marker.classList.remove('selected');
        if (marker.dataset.id === postcardID) {
            marker.classList.add('selected');
        }
    });
}

// ✅ Function to Auto-Pan Map to Marker with Smooth FlyTo and Cluster Handling
function panToMarker(postcard) {
    const lat = parseFloat(postcard.lat);
    const lon = parseFloat(postcard.lon);
    console.log("Panning to:", lat, lon);

    if (!isNaN(lat) && !isNaN(lon)) {
        const marker = markers.getLayers().find(marker => marker.getLatLng().lat === lat && marker.getLatLng().lng === lon);

        if (marker) {
            const targetLatLng = marker.getLatLng();

            // ✅ Check if the marker is already in view
            if (map.getBounds().contains(targetLatLng)) {
                console.log("Marker is already in view. Highlighting.");
                highlightMarker(postcard.postcardID);
                marker.openPopup();
                return;
            }

            // ✅ Ensure the marker is visible and pan to it smoothly
            markers.zoomToShowLayer(marker, () => {
                map.flyTo(targetLatLng, map.getZoom(), {
                    animate: true,
                    duration: 1.5, // Smooth and quick
                    easeLinearity: 0.25
                });

                setTimeout(() => {
                    highlightMarker(postcard.postcardID);
                    marker.openPopup();
                    console.log("Marker shown and highlighted.");
                }, 500); // Small delay for animation
            });
        } else {
            console.warn("Marker not found in cluster. Panning directly.");
            map.flyTo([lat, lon], map.getZoom(), {
                animate: true,
                duration: 1.5,
                easeLinearity: 0.25
            });
            highlightMarker(postcard.postcardID);
        }
    } else {
        console.error("Invalid coordinates for postcard (lat/lon):", postcard);
    }
}


// ✅ Ensure Marker Remains Highlighted after Clustering Updates
markers.on('animationend', () => {
    if (selectedPostcardID) {
        highlightMarker(selectedPostcardID);
    }
});

const sidebarContent = document.getElementById('sidebar-content');
sidebarContent.innerHTML = `<p>Loading postcards...</p>`;

// function updateSidebar(data) {
//     if (!data) {
//         // ✅ If no postcard is selected yet, show this message
//         document.getElementById('sidebar-content').innerHTML = `<p>Click on a marker in the map to view a postcard.</p>`;
//         return;
//     }

//     const sidebarContent = document.getElementById('sidebar-content');
//     sidebarContent.innerHTML = `
//         <div class="postcard-container">
//             <img id="postcard-image" class="postcard-image" src="${data.imageFrontURL}" alt="Postcard Image">
//             ${data.imageBackURL ? `<button id="flip-button" class="flip-btn">⇆</button>` : ""}
//         </div>

//         <p><strong>From:</strong> <span id="postcard-name">${data.name}</span></p>
//         <p><strong>Location:</strong> <span id="postcard-location">${data.placePosted}</span></p>
//         <p><strong>Date:</strong> <span id="postcard-date">${data.datePosted}</span></p>

//         <div class="share-buttons">
//             <button id="copy-link" class="share-btn">Share</button>
//         </div>
//     `;

//     updateURL(data.postcardID);
//     highlightMarker(data.postcardID);

//     // ✅ Ensure Flip Button Works
//     const flipButton = document.getElementById('flip-button');
//     const postcardImage = document.getElementById('postcard-image');

//     if (flipButton && postcardImage) {
//         let showingFront = true;
//         flipButton.style.display = "block";

//         flipButton.addEventListener('click', function () {
//             showingFront = !showingFront;
//             postcardImage.src = showingFront ? data.imageFrontURL : data.imageBackURL;
//         });
//     }

//     // ✅ Copy Link Functionality
//     document.getElementById('copy-link').addEventListener('click', () => {
//         navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?id=${data.postcardID}`)
//             .then(() => alert("Link copied to clipboard!"))
//             .catch(err => console.error("Error copying to clipboard:", err));
//     });
// }






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







// ✅ Sort State
let sortOrder = "date-desc"; // Default: Newest First

// ✅ Initialize Toolbar Event
document.getElementById('sort-by').addEventListener('change', (event) => {
    sortOrder = event.target.value;
    sortPostcards();
    populateGallery(); // Refresh the gallery after sorting
});

// ✅ Function to Sort Postcards
function sortPostcards() {
    postcards.sort((a, b) => {
        if (sortOrder === "date-desc") {
            return new Date(b.datePosted) - new Date(a.datePosted);
        } else if (sortOrder === "date-asc") {
            return new Date(a.datePosted) - new Date(b.datePosted);
        } else if (sortOrder === "south-north-asc") {
            return parseFloat(a.lat) - parseFloat(b.lat);
        } else if (sortOrder === "south-north-desc") {
            return parseFloat(b.lat) - parseFloat(a.lat);
        } else if (sortOrder === "recent-asc") {
            // ✅ Sort by ID (oldest first - ascending)
            return parseInt(a.postcardID) - parseInt(b.postcardID);
        } else if (sortOrder === "recent-desc") {
            // ✅ Sort by ID (newest first - descending)
            return parseInt(b.postcardID) - parseInt(a.postcardID);
        }
        return 0; // Default no sort
    });
}

// ✅ Function to Populate Gallery with Sorting Logic
function populateGallery() {
    galleryView.innerHTML = '';

    // ✅ Sort Postcards Based on Selected Option
    const sortedPostcards = [...postcards];

    // ✅ Populate Sorted Gallery
    sortedPostcards.forEach(postcard => {
        const card = document.createElement('div');
        card.className = 'gallery-card';

        const img = document.createElement('img');
        img.src = showBacks ? getS3ImageURL(postcard.postcardID, 'B') : getS3ImageURL(postcard.postcardID, 'F');
        img.alt = `Postcard from ${postcard.placePosted}`;
        img.loading = 'lazy';

        // ✅ Display name with 'Anonymous' if flagged
        const displayName = postcard.anonymous === 'Y' ? 'Anonymous' : postcard.name;
        console.log(`Gallery - Postcard ${postcard.postcardID} Name: ${displayName} (Anonymous: ${postcard.anonymous})`);

        // ✅ Click event to load sidebar with postcard
        card.addEventListener('click', function() {
            selectedPostcardID = postcard.postcardID; // ✅ Track selected postcard
            updateSidebar(postcard);
            highlightMarker(postcard.postcardID); // ✅ Highlight on Map
            highlightSelectedCard(); // ✅ Highlight in Gallery
        });

        card.appendChild(img);
        galleryView.appendChild(card);
    });
}










// ✅ Initialize "Next Card" Button
document.getElementById("next-card").addEventListener("click", viewNextCard);
document.getElementById("previous-card").addEventListener("click", viewPreviousCard);

// ✅ Function to View Next Card Based on Current Sort Order
function viewNextCard() {
    if (!selectedPostcardID) {
        console.warn("No postcard selected.");
        return;
    }

    console.log("Currently selected postcard:", selectedPostcardID);

    // ✅ Determine Current Sort Order
    const sortType = document.getElementById("sort-by").value;
    const sortedPostcards = [...postcards].sort((a, b) => {
        if (sortType === "date-asc") return new Date(a.datePosted) - new Date(b.datePosted);
        if (sortType === "date-desc") return new Date(b.datePosted) - new Date(a.datePosted);
        if (sortType === "south-north-asc") return parseFloat(a.lat) - parseFloat(b.lat);
        if (sortType === "south-north-desc") return parseFloat(b.lat) - parseFloat(a.lat);
        if (sortType === "recent-asc") return parseInt(a.postcardID) - parseInt(b.postcardID);
        if (sortType === "recent-desc") return parseInt(b.postcardID) - parseInt(a.postcardID);
        return 0;
    });

    console.log("Sorted postcards for next card:", sortedPostcards);

    // ✅ Find Index of Current Card
    const currentIndex = sortedPostcards.findIndex(p => p.postcardID === selectedPostcardID);
    if (currentIndex === -1) {
        console.warn("Selected postcard not found in sorted list.");
        return;
    }

    // ✅ Calculate Next Index (Wrap Around)
    const nextIndex = (currentIndex + 1) % sortedPostcards.length;
    const nextPostcard = sortedPostcards[nextIndex];
    console.log("Next Card:", nextPostcard);

    // ✅ Select the Next Postcard
    selectPostcard(nextPostcard);
}


// ✅ Function to View Previous Card Based on Current Sort Order
function viewPreviousCard() {
    if (!selectedPostcardID) {
        console.warn("No postcard selected.");
        return;
    }

    console.log("Currently selected postcard:", selectedPostcardID);

    // ✅ Determine Current Sort Order
    const sortType = document.getElementById("sort-by").value;
    const sortedPostcards = [...postcards].sort((a, b) => {
        if (sortType === "date-asc") return new Date(a.datePosted) - new Date(b.datePosted);
        if (sortType === "date-desc") return new Date(b.datePosted) - new Date(a.datePosted);
        if (sortType === "south-north-asc") return parseFloat(a.lat) - parseFloat(b.lat);
        if (sortType === "south-north-desc") return parseFloat(b.lat) - parseFloat(a.lat);
        if (sortType === "recent-asc") return parseInt(a.postcardID) - parseInt(b.postcardID);
        if (sortType === "recent-desc") return parseInt(b.postcardID) - parseInt(a.postcardID);
        return 0;
    });

    console.log("Sorted postcards for previous card:", sortedPostcards);

    // ✅ Find Index of Current Card
    const currentIndex = sortedPostcards.findIndex(p => p.postcardID === selectedPostcardID);
    if (currentIndex === -1) {
        console.warn("Selected postcard not found in sorted list.");
        return;
    }

    // ✅ Calculate Previous Index (Wrap Around)
    const prevIndex = (currentIndex - 1 + sortedPostcards.length) % sortedPostcards.length;
    const prevPostcard = sortedPostcards[prevIndex];
    console.log("Previous Card:", prevPostcard);

    // ✅ Select the Previous Postcard
    selectPostcard(prevPostcard);
}


// ✅ Unified Select Postcard Function (Reusable)
function selectPostcard(postcard, initialLoad = false) {
    if (!postcard) {
        console.warn("Invalid postcard selection.");
        return;
    }

    selectedPostcardID = postcard.postcardID;
    console.log("Selected Postcard:", selectedPostcardID);
    
    updateSidebar(postcard);
    highlightMarker(postcard.postcardID); // ✅ Ensure highlight immediately
    highlightSelectedCard();
    panToMarker(postcard, initialLoad); // ✅ Use smooth flyTo for both initial load and navigation
    updateURL(postcard.postcardID);
}


// ✅ Event Listener for Map Marker Click
markers.on('click', function(event) {
    const postcardID = event.target.options.id;
    const selectedPostcard = postcards.find(p => p.postcardID === postcardID);
    if (selectedPostcard) {
        selectPostcard(selectedPostcard);
    }
});

// ✅ Trigger Initial Selection (URL or Random)
document.addEventListener("DOMContentLoaded", () => {
    console.log("Loading Initial Postcard...");
    selectPostcardFromURL();
});



// ✅ Global Variable to Track Front/Back View
let showBacks = false;

// ✅ Initialize Toggle Button
document.getElementById("toggle-view").addEventListener("click", togglePostcardView);

// ✅ Function to Toggle Front/Back View
function togglePostcardView() {
    showBacks = !showBacks;
    document.getElementById("toggle-view").textContent = showBacks ? "Show Fronts" : "Show Backs";
    populateGallery(); // ✅ Refresh Gallery with New View
    if (selectedPostcardID) {
        const selectedPostcard = postcards.find(p => p.postcardID === selectedPostcardID);
        if (selectedPostcard) updateSidebar(selectedPostcard); // ✅ Update Sidebar
    }
}














// ✅ Function to Rotate the Postcard
function rotatePostcard() {
    const postcardImage = document.getElementById("postcard-image");
    if (!postcardImage) {
        console.warn("No postcard image found.");
        return;
    }

    console.log("Rotating Postcard");

    // ✅ Get current rotation value (or set to 0 if not set)
    let currentRotation = parseFloat(postcardImage.getAttribute("data-rotation") || 0);
    
    // ✅ Increment rotation by 90 degrees
    currentRotation = (currentRotation + 90) % 360;

    // ✅ Apply rotation using CSS transform
    postcardImage.style.transform = `rotate(${currentRotation}deg)`;
    postcardImage.style.transition = "transform 0.3s ease-in-out"; // Smooth transition

    // ✅ Store the rotation value in a data attribute for persistence
    postcardImage.setAttribute("data-rotation", currentRotation);
}













// ✅ Function to Rotate the Postcard
function rotatePostcard() {
    const postcardContainer = document.querySelector(".postcard-container");
    const postcardImage = document.getElementById("postcard-image");
    if (!postcardImage || !postcardContainer) {
        console.warn("No postcard image or container found.");
        return;
    }

    console.log("Rotating Postcard");

    // ✅ Get current rotation value (or set to 0 if not set)
    let currentRotation = parseFloat(postcardImage.getAttribute("data-rotation") || 0);
    
    // ✅ Increment rotation by 90 degrees
    currentRotation = (currentRotation + 90) % 360;
    postcardImage.style.transform = `rotate(${currentRotation}deg)`;
    postcardImage.style.transition = "transform 0.3s ease-in-out"; // Smooth transition

    // ✅ Toggle container class for vertical/horizontal
    if (currentRotation === 90 || currentRotation === 270) {
        postcardContainer.classList.add("rotated");
    } else {
        postcardContainer.classList.remove("rotated");
    }

    // ✅ Store the rotation value in a data attribute for persistence
    postcardImage.setAttribute("data-rotation", currentRotation);
}








// ✅ Function to Load and Display Mile Markers with Text Labels (Non-Interactable)
let mileMarkersLayer; // Global variable for the marker layer

function addMileMarkers() {
    fetch('data/Full_PCT_Mile_Marker.geojson')
        .then(response => response.json())
        .then(data => {
            mileMarkersLayer = L.geoJSON(data, {
                pointToLayer: function(feature, latlng) {
                    const marker = L.divIcon({
                        className: 'mile-marker-label',
                        html: `
                            <div class="mile-marker-dot"></div>
                            <span class="mile-marker-text">${Math.round(feature.properties.Mile)}</span>
                        `,
                        iconSize: [0, 0], // No icon background
                    });

                    return L.marker(latlng, { icon: marker, interactive: false }); // ✅ Non-interactive
                }
            }).addTo(map);

            map.on("zoomstart", hideMileMarkers); // ✅ Hide markers on zoom start
            map.on("zoomend", updateMileMarkers); // ✅ Show markers on zoom end
            updateMileMarkers(); // ✅ Initial filter based on zoom
        })
        .catch(error => console.error("Error loading mile markers:", error));
}

// ✅ Function to Hide All Mile Markers During Zoom
function hideMileMarkers() {
    if (mileMarkersLayer) {
        mileMarkersLayer.eachLayer(layer => {
            layer.getElement().style.display = "none";
        });
    }
}

// ✅ Function to Filter Mile Markers Based on Zoom Level
function updateMileMarkers() {
    if (!mileMarkersLayer) return;

    const currentZoom = map.getZoom();
    console.log("Current Zoom Level:", currentZoom);

    mileMarkersLayer.eachLayer(function(layer) {
        const mile = layer.feature.properties.Mile;
        let shouldShow = false;

        if (currentZoom >= 14) {
            shouldShow = Number.isInteger(mile); // ✅ Show only whole numbers at high zoom
        } else if (currentZoom >= 12) {
            shouldShow = mile % 5 === 0;
        } else if (currentZoom >= 11) {
            shouldShow = mile % 10 === 0;
        } else if (currentZoom >= 9) {
            shouldShow = mile % 50 === 0;
        } else if (currentZoom >= 7) {
            shouldShow = mile % 100 === 0;
        } else if (currentZoom >= 5) {
            shouldShow = mile % 500 === 0;
        } else {
            shouldShow = false; // Hide all at very low zoom
        }

        layer.getElement().style.display = shouldShow ? "block" : "none";
    });
}

// ✅ Call the function to load mile markers when the map is initialized
addMileMarkers();
